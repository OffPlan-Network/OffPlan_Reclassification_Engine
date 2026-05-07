// Stochastic liquidity layer — Monte Carlo over claim timing to size the
// employer's Min Required Liquidity (MRL) under the OffPlan model.
//
// MVP scope (Liquidity & Capital Modeling Spec v1.2 calls these out as the
// two stochastic dimensions; we ship the first only and document the gap):
//
//   IN  — Timing variance: each modeled claim is placed on a uniform-random
//         month; stop-loss reimbursement arrives 3 months after the claim.
//         Across 1,000 runs we get the distribution of worst-month
//         drawdown, take P95 = MRL.
//   OUT — Event-frequency / cost-tail variance (heavy-tail Pareto on T8/T9,
//         negbin frequency for chronic-heavy populations, complication
//         clustering, aggregate stop-loss). Deferred to a follow-on build;
//         documented in README §11.
//
// Calibration: this approach resamples the *existing* deterministic claims,
// so E[annual residual across runs] ≡ deterministic residual_fund by
// construction. There is no calibration drift to monitor — that check
// becomes meaningful only when we add tier-based event generation.
//
// Pure function: runs in the browser today (main thread or Web Worker)
// and on a Vercel Function unchanged tomorrow. No imports of localStorage
// or browser-only globals.

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

function simulateOnce(claims, monthlyContribution, lagMonths, rng) {
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

  // MRL = max upfront capital required so that R + cumulative_replenishment +
  // cumulative_reimbursement - cumulative_outflow >= 0 across all months.
  // Equivalently: max over t of cumulative net outflow.
  let required = 0;
  let cumDeficit = 0;
  for (let t = 0; t < 12; t++) {
    cumDeficit += monthlyOutflow[t] - monthlyContribution - monthlyReimbursement[t];
    if (cumDeficit > required) required = cumDeficit;
  }
  return { mrl: required, monthlyOutflow };
}

/**
 * Run a Monte Carlo to size Min Required Liquidity (MRL) for the OffPlan
 * residual + stop-loss cash flow.
 *
 * @param {object} args
 * @param {object} args.employer        Employer profile (covered_lives, current_total_healthcare_spend, id)
 * @param {object} args.scenario        Active scenario (name used for cache keying only)
 * @param {Array}  args.modeledClaims   Output of runCalculation().claims — each has residual_amount + stop_loss_amount + indemnity_offset stamped on
 * @param {object} [args.options]
 * @param {number} [args.options.runs=1000]      Simulation count
 * @param {number} [args.options.lagMonths=3]    Stop-loss reimbursement lag in months (75 days ≈ 3)
 * @returns {object} LiquidityResult
 */
export function simulateLiquidity({ employer, scenario, modeledClaims, options = {} }) {
  const runs = Math.max(1, options.runs || 1000);
  const lagMonths = Math.max(0, options.lagMonths ?? 3);

  // Filter excluded claims defensively, even though the cascade should have
  // already dropped them.
  const claims = (modeledClaims || []).filter((c) => !c.excluded);

  // Annual residual fund + stop-loss shift, divided into 12 equal monthly
  // contributions. This represents the employer's planned monthly funding
  // rate. We add the stop-loss component because the employer's reserve
  // must fund those outflows during the reimbursement lag too — the carrier
  // ultimately reimburses, but the contribution model needs to account for
  // the float.
  const totalCashFlow = claims.reduce(
    (s, c) => s + (Number(c.residual_amount) || 0) + (Number(c.stop_loss_amount) || 0),
    0,
  );
  const monthlyContribution = totalCashFlow / 12;

  const seed = hashSeed([employer?.id, scenario?.name, runs, lagMonths]);
  const rng = mulberry32(seed);

  const mrls = new Float64Array(runs);
  let monthlyOutflowSum = 0;
  let monthlyOutflowCount = 0;

  for (let i = 0; i < runs; i++) {
    const r = simulateOnce(claims, monthlyContribution, lagMonths, rng);
    mrls[i] = r.mrl;
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
    annual_cash_flow: totalCashFlow,
    elf,
    meta: {
      runs,
      horizon_months: 12,
      lag_months: lagMonths,
      seed,
      method: 'timing-resample-v0',
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
