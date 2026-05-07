// Stochastic liquidity layer — Monte Carlo to size the employer's Min
// Required Liquidity (MRL) under the OffPlan model.
//
// Two stochastic dimensions ship in this build:
//
//   1. Timing variance (v0). Each modeled claim from the deterministic
//      cascade is placed on a uniform-random month; stop-loss reimbursement
//      arrives 3 months after the claim hits.
//
//   2. Catastrophic event tail overlay (v1). Each run draws
//      N ~ Poisson(lambda × covered_lives) extra catastrophic events on
//      top of the deterministic claims. Each event has random month and
//      Pareto-distributed cost; the cost is split at the scenario's stop-
//      loss attachment point and reimbursement lags by the same window.
//      Without this, simulator output is a *lower bound* on MRL because it
//      only knows about the catastrophic events that actually happened in
//      the deterministic year. With it, P95 widens to reflect population-
//      level tail risk.
//
// Still deferred: chronic clustering, complication lag, NegBin frequency,
// aggregate stop-loss corridor, bootstrap CIs on percentiles. README §11
// documents the gap.
//
// Calibration: the timing-resample component matches deterministic residual
// by construction (we resample the same claims). The tail overlay adds
// expected outflow proportional to lambda × scale × shape/(shape−1) per
// member-year; it is a small additive contribution by design (default
// lambda=0.005 → ~$0.4–$0.8 PMPM on the mean). The single calibration knob
// is lambda; scale + shape are anchored to industry stop-loss benchmarks.
//
// Pure function: runs in the browser today (main thread or Web Worker)
// and on a Vercel Function unchanged tomorrow. No imports of localStorage
// or browser-only globals.

import { CATASTROPHIC_TAIL_DEFAULTS } from '../constants.js';

// Mulberry32 — same PRNG used by scripts/generate-demo-claims.mjs. Cheap,
// deterministic, good enough for Monte Carlo.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a hash to derive a deterministic seed from (employer, scenario, runs).
// Using a string seed means changing any of the three inputs produces a
// different simulation, which is what we want for cache invalidation.
function hashSeed(parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p ?? '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * (p / 100))));
  return sorted[idx];
}

// Knuth's Poisson sampler. Cheap and exact for small lambda (we expect
// lambda × lives in single digits for SMB populations).
function samplePoisson(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda < 60) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation for large lambda. Box-Muller for the Z draw.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

// Pareto Type I inverse CDF. shape > 0; smaller shape = heavier tail.
// shape > 1 required for finite mean; shape > 2 for finite variance.
function sampleParetoTypeI(scale, shape, rng) {
  // Avoid u=0 producing Infinity.
  const u = Math.max(rng(), 1e-12);
  return scale * Math.pow(u, -1 / shape);
}

function simulateOnce(claims, monthlyContribution, lagMonths, rng, tailOverlay) {
  const monthlyOutflow = new Array(12).fill(0);
  const monthlyReimbursement = new Array(12).fill(0);

  for (const c of claims) {
    const month = Math.floor(rng() * 12);
    const residual = Number(c.residual_amount) || 0;
    const stopLoss = Number(c.stop_loss_amount) || 0;

    // Pre-Reimbursement Outflow: the employer pays both the residual portion
    // and the stop-loss-eligible portion at the time of service. The
    // stop-loss reimbursement arrives later (lagMonths from now); until it
    // does, the reserve must float the full amount.
    const cashOutNow = residual + stopLoss;
    monthlyOutflow[month] += cashOutNow;

    if (stopLoss > 0) {
      const reimbMonth = Math.min(11, month + lagMonths);
      monthlyReimbursement[reimbMonth] += stopLoss;
    }
  }

  // Catastrophic tail overlay — extra Pareto-distributed events on top of
  // the resampled deterministic claims. Each event is split at the
  // scenario's stop-loss attachment point: residual portion stays with the
  // employer permanently; stop-loss portion is reimbursed lagMonths later.
  let tailEventCount = 0;
  let tailGrossOutflow = 0;
  if (tailOverlay && tailOverlay.expectedCount > 0) {
    const n = samplePoisson(tailOverlay.expectedCount, rng);
    tailEventCount = n;
    for (let i = 0; i < n; i++) {
      const month = Math.floor(rng() * 12);
      const cost = sampleParetoTypeI(tailOverlay.paretoScale, tailOverlay.paretoShape, rng);
      const attachment = tailOverlay.attachmentPoint;
      const residualPortion = Math.min(cost, attachment);
      const stopLossPortion = Math.max(0, cost - attachment);

      monthlyOutflow[month] += cost;
      tailGrossOutflow += cost;

      if (stopLossPortion > 0) {
        const reimbMonth = Math.min(11, month + lagMonths);
        monthlyReimbursement[reimbMonth] += stopLossPortion;
      }
    }
  }

  // MRL = max upfront capital required so that R + cumulative_replenishment +
  // cumulative_reimbursement - cumulative_outflow >= 0 across all months.
  // Equivalently: max over t of cumulative net outflow.
  let required = 0;
  let cumDeficit = 0;
  for (let t = 0; t < 12; t++) {
    cumDeficit += monthlyOutflow[t] - monthlyContribution - monthlyReimbursement[t];
    if (cumDeficit > required) required = cumDeficit;
  }
  return { mrl: required, monthlyOutflow, tailEventCount, tailGrossOutflow };
}

/**
 * Run a Monte Carlo to size Min Required Liquidity (MRL) for the OffPlan
 * residual + stop-loss cash flow.
 *
 * @param {object} args
 * @param {object} args.employer        Employer profile (covered_lives, current_total_healthcare_spend, id)
 * @param {object} args.scenario        Active scenario (attachment_point + name used)
 * @param {Array}  args.modeledClaims   Output of runCalculation().claims — each has residual_amount + stop_loss_amount + indemnity_offset stamped on
 * @param {object} [args.options]
 * @param {number} [args.options.runs=1000]                 Simulation count
 * @param {number} [args.options.lagMonths=3]               Stop-loss reimbursement lag in months (75 days ≈ 3)
 * @param {object|false} [args.options.tailOverlay]         Catastrophic tail overlay params; pass `false` to disable. Defaults to CATASTROPHIC_TAIL_DEFAULTS from constants.
 * @returns {object} LiquidityResult
 */
export function simulateLiquidity({ employer, scenario, modeledClaims, options = {} }) {
  const runs = Math.max(1, options.runs || 1000);
  const lagMonths = Math.max(0, options.lagMonths ?? 3);

  // Resolve tail-overlay parameters. options.tailOverlay === false disables
  // the overlay entirely (used by tests that want pure-resample numbers).
  // options.tailOverlay can also be a partial override of the defaults.
  const tailCfg = options.tailOverlay === false
    ? null
    : { ...CATASTROPHIC_TAIL_DEFAULTS, ...(options.tailOverlay || {}) };

  const lives = Math.max(1, Number(employer?.covered_lives) || 0);
  const attachmentPoint = Number(scenario?.attachment_point) || 50000;
  const tailOverlay = tailCfg && tailCfg.enabled
    ? {
        expectedCount: tailCfg.lambda_per_member_year * lives,
        paretoScale: tailCfg.pareto_scale,
        paretoShape: tailCfg.pareto_shape,
        attachmentPoint,
      }
    : null;

  // Filter excluded claims defensively, even though the cascade should have
  // already dropped them.
  const claims = (modeledClaims || []).filter((c) => !c.excluded);

  // Annual residual fund + stop-loss shift, divided into 12 equal monthly
  // contributions. This represents the employer's planned monthly funding
  // rate. We add the stop-loss component because the employer's reserve
  // must fund those outflows during the reimbursement lag too — the carrier
  // ultimately reimburses, but the contribution model needs to account for
  // the float.
  const deterministicCashFlow = claims.reduce(
    (s, c) => s + (Number(c.residual_amount) || 0) + (Number(c.stop_loss_amount) || 0),
    0,
  );
  // Tail overlay's expected contribution to monthly contribution: events
  // generate gross outflow but stop-loss reimburses the portion above
  // attachment. So the *net* expected annual outflow for the employer is
  // the residual portion only: E[min(cost, attachment)] × expectedCount.
  // For Pareto Type I, E[min(X, c)] = scale * shape/(shape-1) * (1 - (scale/c)^(shape-1)) when c >= scale,
  // simplified: closed-form below.
  let tailExpectedNetOutflow = 0;
  if (tailOverlay) {
    const { paretoScale, paretoShape, attachmentPoint: a, expectedCount } = tailOverlay;
    if (a >= paretoScale && paretoShape > 1) {
      // E[min(X, a)] = scale * (shape/(shape-1)) * (1 - (scale/a)^(shape-1))
      const meanCapped = paretoScale * (paretoShape / (paretoShape - 1)) * (1 - Math.pow(paretoScale / a, paretoShape - 1));
      tailExpectedNetOutflow = meanCapped * expectedCount;
    }
  }
  const totalAnnualCashFlow = deterministicCashFlow + tailExpectedNetOutflow;
  const monthlyContribution = totalAnnualCashFlow / 12;

  const seed = hashSeed([employer?.id, scenario?.name, runs, lagMonths, attachmentPoint, tailOverlay ? tailOverlay.expectedCount.toFixed(4) : 'no-tail']);
  const rng = mulberry32(seed);

  const mrls = new Float64Array(runs);
  let monthlyOutflowSum = 0;
  let monthlyOutflowCount = 0;
  let totalTailEvents = 0;
  let totalTailGrossOutflow = 0;

  for (let i = 0; i < runs; i++) {
    const r = simulateOnce(claims, monthlyContribution, lagMonths, rng, tailOverlay);
    mrls[i] = r.mrl;
    totalTailEvents += r.tailEventCount;
    totalTailGrossOutflow += r.tailGrossOutflow;
    for (let t = 0; t < 12; t++) {
      monthlyOutflowSum += r.monthlyOutflow[t];
      monthlyOutflowCount++;
    }
  }

  const sorted = Array.from(mrls).sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p90 = percentile(sorted, 90);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  const meanMonthlyOutflow = monthlyOutflowCount > 0 ? monthlyOutflowSum / monthlyOutflowCount : 0;

  // ELF = Equivalent Level-Funded Total Cost. Per Liquidity Spec §3.1, this
  // is what the employer would pre-fund under a traditional level-funded
  // plan, total-to-total. We use current_total_healthcare_spend as the best
  // available proxy when the employer has supplied a baseline.
  const elf = Number(employer?.current_total_healthcare_spend) || 0;
  const mrl = p95;

  return {
    mrl,
    cer: elf > 0 && mrl > 0 ? elf / mrl : null,
    liquidity_reduction_pct: elf > 0 && mrl > 0 ? (elf - mrl) / elf : null,
    lcr: meanMonthlyOutflow > 0 ? mrl / meanMonthlyOutflow : null,
    scr: p75 > 0 ? mrl / p75 : null,
    percentiles: { p50, p75, p90, p95, p99 },
    mean_monthly_outflow: meanMonthlyOutflow,
    monthly_contribution: monthlyContribution,
    annual_cash_flow: totalAnnualCashFlow,
    deterministic_cash_flow: deterministicCashFlow,
    tail_expected_annual_net_outflow: tailExpectedNetOutflow,
    elf,
    tail: tailOverlay
      ? {
          enabled: true,
          lambda_per_member_year: tailCfg.lambda_per_member_year,
          pareto_scale: tailCfg.pareto_scale,
          pareto_shape: tailCfg.pareto_shape,
          expected_events_per_year: tailOverlay.expectedCount,
          observed_events_total: totalTailEvents,
          observed_events_per_run: runs > 0 ? totalTailEvents / runs : 0,
          observed_gross_outflow_total: totalTailGrossOutflow,
        }
      : { enabled: false },
    meta: {
      runs,
      horizon_months: 12,
      lag_months: lagMonths,
      seed,
      method: tailOverlay ? 'timing-resample-with-tail-overlay-v1' : 'timing-resample-v0',
      generated_at: new Date().toISOString(),
    },
  };
}

// Cache key for the storage layer. Same scenario + same claims set + same
// run count → same MRL number, so we can avoid re-running on every
// dashboard mount.
export function liquidityCacheKey(employerId, scenarioName, runs = 1000) {
  return `liquidity:${employerId}:${scenarioName}:${runs}`;
}
