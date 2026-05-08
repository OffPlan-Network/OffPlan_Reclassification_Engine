// Stochastic liquidity layer — Monte Carlo to size the employer's Min
// Required Liquidity (MRL) under the OffPlan model.
//
// Two simulation modes ship, surfaced as a Dashboard toggle:
//
//   - timing-resample (default): resamples the deterministic claims onto
//     random months, plus a Pareto catastrophic event tail overlay so the
//     output is not bounded by the catastrophic events that happened to
//     land in the historical year.
//
//   - tier-generated (v2): generates events fresh per run from the 11-tier
//     EVENT_TIER_CATALOG (Poisson/NegBin frequency × log-normal/Pareto
//     cost), runs them through the full member-aggregating cascade
//     (per-event reduction → indemnity offset → member-aggregate stop-loss
//     split), and reports a calibration drift_pct vs the deterministic
//     residual.
//
// Both modes apply: 3-month specific stop-loss reimbursement lag,
// aggregate stop-loss corridor (when enabled in scenario), bootstrap 95%
// CIs on every reported percentile, and a stop-loss claim payment spread
// (default 1/3 / 1/3 / 1/3 across three months) modeling adjudication
// delay + invoice terms on catastrophic claims.
//
// Tier-generated mode also models chronic clustering: each run pre-samples
// which member IDs are chronic (Bernoulli with CHRONIC_PREVALENCE), and
// per-tier events are drawn from a chronic pool at λ × effective_uplift
// and a non-chronic pool at λ. Repeated draws on the smaller chronic pool
// concentrate events on the same members. Both chronic uplift and
// per-tier complication probability are reduced by the scenario's
// `dpc_clinical_mitigation_pct` to model DPC's clinical effect — the
// monthly-membership model absorbs chronic management and catches
// complication early-warnings before they cascade.
//
// T10 Specialty Rx uses the spec's monthly-recurrence model: a small
// subset of chronic members (regimen_member_fraction = 3% of population
// by default) is "on regimen" for the year and fills monthly. See the
// regimen-mode branch in simulateOnceFromCatalog.
//
// Still deferred per Liquidity Spec v1.2: the bimodal Maternity/NICU
// split (T11). README §11 documents the gap.
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

import { CATASTROPHIC_TAIL_DEFAULTS, EVENT_TIER_CATALOG, DEFAULT_INDEMNITY_BENEFITS, CHRONIC_PREVALENCE, CHRONIC_TIER_UPLIFT, STOP_LOSS_PAYMENT_SCHEDULE } from '../constants.js';

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

// Bootstrap 95% confidence intervals on a set of percentiles. Resamples
// `samples` (Float64Array) with replacement M times, computes the
// requested percentile for each resample, and returns the 2.5% / 97.5%
// quantiles of those bootstrap percentile estimates.
function bootstrapPercentileCIs(samples, percentilesToCompute, M = 500, rng = Math.random) {
  const n = samples.length;
  if (n === 0) {
    const empty = {};
    for (const p of percentilesToCompute) empty[p] = { lo: 0, hi: 0 };
    return empty;
  }
  // Per-percentile array of bootstrap estimates.
  const estimates = {};
  for (const p of percentilesToCompute) estimates[p] = new Float64Array(M);

  const resampled = new Float64Array(n);
  for (let m = 0; m < M; m++) {
    for (let i = 0; i < n; i++) {
      resampled[i] = samples[Math.floor(rng() * n)];
    }
    const sorted = Array.from(resampled).sort((a, b) => a - b);
    for (const p of percentilesToCompute) {
      estimates[p][m] = percentile(sorted, p);
    }
  }

  const out = {};
  for (const p of percentilesToCompute) {
    const sorted = Array.from(estimates[p]).sort((a, b) => a - b);
    out[p] = {
      lo: percentile(sorted, 2.5),
      hi: percentile(sorted, 97.5),
    };
  }
  return out;
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

// Gamma sampling via Marsaglia & Tsang (2000) — fast and accurate for
// shape >= 1; for shape < 1 we use the boost trick (sample shape+1 then
// scale by U^(1/shape)). Used as the mixing distribution for Negative
// Binomial sampling below.
function sampleGamma(shape, scale, rng) {
  if (shape < 1) {
    const g = sampleGamma(shape + 1, scale, rng);
    const u = Math.max(rng(), 1e-12);
    return g * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x;
    let v;
    do {
      // Box-Muller for the standard normal draw.
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), 1e-12);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

// Negative Binomial sampler via Gamma-Poisson mixture. Parameterized as
// (mean, dispersion k) where variance = mean + mean^2 / k. Smaller k =
// more over-dispersion. As k → infinity NegBin → Poisson.
function sampleNegBin(mean, k, rng) {
  if (mean <= 0) return 0;
  if (!(k > 0) || !isFinite(k)) return samplePoisson(mean, rng);
  // Gamma scale = mean / k; sampled lambda is Poisson rate for this run.
  const lambda = sampleGamma(k, mean / k, rng);
  return samplePoisson(lambda, rng);
}

// Log-normal sampling via Box-Muller for the Z draw. Returns exp(mu + sigma*Z).
function sampleLogNormal(mu, sigma, rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + sigma * z);
}

// Sample a cost from a tier's distribution.
function sampleTierCost(tier, rng) {
  if (tier.cost_dist === 'pareto') {
    return sampleParetoTypeI(tier.pareto_scale, tier.pareto_shape, rng);
  }
  // Default: log-normal.
  return sampleLogNormal(tier.cost_mu, tier.cost_sigma, rng);
}

// Per-event reduction (DPC / cash-pay / ER). This is the per-claim part
// of the OffPlan transformation; member-aggregate stop-loss and indemnity
// caps are applied in subsequent passes. Bucket E events keep their full
// allowed amount here — stop-loss split happens after member aggregation.
function reduceEventAllowed(allowed, bucket, scenario) {
  if (bucket === 'A') {
    return allowed * (1 - (scenario.dpc_elimination_pct ?? 0.85));
  }
  if (bucket === 'B') {
    return allowed * (scenario.cashpay_discount_factor ?? 0.5);
  }
  if (bucket === 'C') {
    return allowed * (1 - (scenario.er_reduction_pct ?? 0.25));
  }
  // Buckets D and E: full allowed (E gets stop-loss split later).
  return allowed;
}

// Used only for the closed-form contribution-rate estimator. Approximates
// expected residual using the per-claim attachment split (vs the proper
// member-aggregate split that runs at simulation time).
function transformEventForContribution(meanCost, bucket, scenario) {
  const reduced = reduceEventAllowed(meanCost, bucket, scenario);
  if (bucket === 'E') {
    const attachment = Number(scenario.attachment_point) || 50000;
    return {
      residual: Math.min(reduced, attachment),
      stopLoss: Math.max(0, reduced - attachment),
    };
  }
  return { residual: reduced, stopLoss: 0 };
}

// Map a (bucket, category, modeled_cost) tuple to the indemnity event_type
// the deterministic engine uses. Mirrors calculate.js:67-71.
function indemnityEventType(bucket, category, modeledCost) {
  if (bucket === 'C' && category === 'ER') return 'ER';
  if (category === 'Inpatient') return 'Hospital Admission';
  if (category === 'Imaging' && modeledCost > 200) return 'Imaging';
  if (category === 'Outpatient Surgery') return 'Outpatient Surgery';
  if (category === 'Procedures' && modeledCost > 1000) return 'Outpatient Surgery';
  return null;
}

// Run one simulation through the full three-pass OffPlan cascade. Mirrors
// the deterministic runCalculation logic in src/engine/calculate.js but
// inlines for performance (5K runs × ~1K events stays under 1s):
//
//   Pass 1: generate events with synthetic member IDs; apply per-event
//           reductions (DPC / cashpay / ER) to get modeled_cost
//   Pass 2: indemnity offset, walking events cost-desc with per-member
//           per-event-type benefit caps from indemnityBenefits
//   Pass 3: stop-loss split, aggregating per-member first then draining
//           overage from each member's largest claims
//   Pass 4: bucket events to monthly outflow / reimbursement arrays
//
// Returns { monthlyOutflow, monthlyReimbursement, annualResidual,
//           annualIndemnityOffset, annualStopLossShift, totalEvents }.
function simulateOnceFromCatalog({ catalog, lives, scenario, lagMonths, rng, indemnityBenefits, chronicPrevalence, paymentSchedule }) {
  // DPC clinical mitigation factor. Reduces both per-tier complication
  // probability and the chronic-clustering uplift toward their unmitigated
  // base — DPC catches early warnings (lower complication cascades) and
  // absorbs chronic management into monthly membership (lower flare-driven
  // event clustering on chronic members).
  const dpcMitigation = Math.min(1, Math.max(0, Number(scenario.dpc_clinical_mitigation_pct) || 0));

  // Chronic pool. Pre-sample at run start so the same chronic member set is
  // shared across all tiers within the run. Member IDs 0..chronicCount-1 are
  // chronic; chronicCount..lives-1 are non-chronic. (No global member registry
  // is needed — only the index range matters.)
  const prevalence = Math.min(1, Math.max(0, Number(chronicPrevalence)));
  const chronicCount = Math.round(lives * prevalence);
  const nonchronicCount = lives - chronicCount;

  // Pass 1: generate primary events plus complications. Complications occur
  // with probability tier.complication_probability × (1 − dpcMitigation),
  // on the same member, of the same tier, lag_days later (log-normal). Cap
  // depth at 3 so a chain of complications can't run away — beyond that,
  // prevalence falls off sharply per published utilization data anyway.
  const events = [];
  let totalComplications = 0;
  const MAX_DEPTH = 3;

  function generateOne(tier, memberId, monthAtIndex, depth) {
    const allowed = sampleTierCost(tier, rng);
    const month = monthAtIndex != null ? monthAtIndex : Math.floor(rng() * 12);
    const modeledCost = reduceEventAllowed(allowed, tier.bucket, scenario);
    events.push({
      memberId,
      month,
      bucket: tier.bucket,
      category: tier.normalized_category,
      allowed,
      modeledCost,
      indemnityOffset: 0,
      stopLossAmount: 0,
    });

    // Roll for a complication, if this tier has one configured and we
    // haven't exceeded recursion depth. DPC mitigation shrinks the rate.
    const baseCp = Number(tier.complication_probability) || 0;
    const cp = baseCp * (1 - dpcMitigation);
    if (cp > 0 && depth < MAX_DEPTH && rng() < cp) {
      const median = Number(tier.complication_lag_days_median) || 21;
      const sigma = Number(tier.complication_lag_days_sigma) || 0.5;
      const lagDays = sampleLogNormal(Math.log(median), sigma, rng);
      const monthDelta = Math.floor(lagDays / 30);
      const compMonth = Math.min(11, month + monthDelta);
      totalComplications++;
      generateOne(tier, memberId, compMonth, depth + 1);
    }
  }

  let chronicEventCount = 0;
  let regimenMemberCount = 0;
  for (const tier of catalog) {
    // Regimen-mode tier (T10 specialty Rx today). Bypasses the standard
    // chronic / non-chronic pool sampling. A small subset of chronic
    // members is "on regimen" for the year and fills monthly; cost is
    // sampled per fill so PBM/dispensing variance is captured. Liquidity
    // Spec v1.2 §4 monthly-recurrence model.
    if (tier.regimen_mode === 'monthly_recurrence' && chronicCount > 0) {
      const fraction = Number(tier.regimen_member_fraction) || 0;
      const fillsPerYear = Number(tier.fills_per_member_year) || 12;
      const regimenCount = Math.min(chronicCount, Math.max(0, Math.floor(lives * fraction)));
      regimenMemberCount += regimenCount;
      // Regimen members are a subset of the chronic pool (indices 0..regimenCount-1).
      // Each regimen member fills monthly; complications don't apply
      // (Rx fills are not procedural events that cascade).
      for (let m = 0; m < regimenCount; m++) {
        const memberId = m;
        for (let f = 0; f < fillsPerYear; f++) {
          const month = Math.min(11, Math.floor((f / fillsPerYear) * 12));
          const allowed = sampleTierCost(tier, rng);
          const modeledCost = reduceEventAllowed(allowed, tier.bucket, scenario);
          events.push({
            memberId,
            month,
            bucket: tier.bucket,
            category: tier.normalized_category,
            allowed,
            modeledCost,
            indemnityOffset: 0,
            stopLossAmount: 0,
          });
          chronicEventCount++;
        }
      }
      continue;
    }

    const baseLambda = Number(tier.lambda_per_member_year) || 0;
    const rawUplift = Number(CHRONIC_TIER_UPLIFT[tier.tier]) || 1;
    const effectiveUplift = 1 + (rawUplift - 1) * (1 - dpcMitigation);

    // Chronic pool: λ × effectiveUplift × chronicCount. Drawing from a
    // smaller pool with a higher rate is what produces clustering: the
    // same chronic memberId is more likely to come up multiple times.
    if (chronicCount > 0) {
      const expected = baseLambda * effectiveUplift * chronicCount;
      if (expected > 0) {
        const n = tier.freq_dist === 'negbin' && tier.freq_k > 0
          ? sampleNegBin(expected, tier.freq_k, rng)
          : samplePoisson(expected, rng);
        for (let i = 0; i < n; i++) {
          const memberId = Math.floor(rng() * chronicCount);
          generateOne(tier, memberId, null, 0);
          chronicEventCount++;
        }
      }
    }

    // Non-chronic pool: base λ × nonchronicCount.
    if (nonchronicCount > 0) {
      const expected = baseLambda * nonchronicCount;
      if (expected > 0) {
        const n = tier.freq_dist === 'negbin' && tier.freq_k > 0
          ? sampleNegBin(expected, tier.freq_k, rng)
          : samplePoisson(expected, rng);
        for (let i = 0; i < n; i++) {
          const memberId = chronicCount + Math.floor(rng() * nonchronicCount);
          generateOne(tier, memberId, null, 0);
        }
      }
    }
  }
  const totalEvents = events.length;

  // Pass 2: indemnity offset.
  let annualIndemnityOffset = 0;
  if (scenario.indemnity_enabled && indemnityBenefits) {
    // Walk in modeled-cost-descending order so the largest events claim
    // benefits first (matches the deterministic engine's behavior).
    const sorted = events.slice().sort((a, b) => b.modeledCost - a.modeledCost);
    const memberUsage = new Map(); // key: `${memberId}|${eventType}` → count
    for (const e of sorted) {
      const eventType = indemnityEventType(e.bucket, e.category, e.modeledCost);
      if (!eventType) continue;
      const benefit = indemnityBenefits[eventType];
      if (!benefit || !benefit.maxPerYear) continue;
      const key = e.memberId + '|' + eventType;
      const usage = memberUsage.get(key) || 0;
      if (usage >= benefit.maxPerYear) continue;
      const offset = Math.min(benefit.benefit, e.modeledCost);
      e.indemnityOffset = offset;
      e.modeledCost = Math.max(0, e.modeledCost - offset);
      annualIndemnityOffset += offset;
      memberUsage.set(key, usage + 1);
    }
  }

  // Pass 3: member-aggregate stop-loss split.
  const attachment = Number(scenario.attachment_point) || 50000;
  let annualStopLossShift = 0;
  // Group events by member.
  const memberEvents = new Map();
  for (const e of events) {
    if (!memberEvents.has(e.memberId)) memberEvents.set(e.memberId, []);
    memberEvents.get(e.memberId).push(e);
  }
  for (const [_, claims] of memberEvents) {
    let total = 0;
    for (const c of claims) total += c.modeledCost;
    if (total <= attachment) continue;
    const overage = total - attachment;
    claims.sort((a, b) => b.modeledCost - a.modeledCost);
    let remaining = overage;
    for (const c of claims) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, c.modeledCost);
      c.stopLossAmount = take;
      c.modeledCost -= take;
      remaining -= take;
      annualStopLossShift += take;
    }
  }

  // Pass 4: monthly aggregation. Stop-loss-eligible events spread their
  // outflow across paymentSchedule months (default 1/3 / 1/3 / 1/3) to
  // model adjudication delay + invoice terms; smaller events settle
  // same-month. Reimbursement still arrives at month + lagMonths from
  // the original event incident.
  const monthlyOutflow = new Array(12).fill(0);
  const monthlyReimbursement = new Array(12).fill(0);
  let annualResidual = 0;
  const spread = paymentSchedule && paymentSchedule.length > 1;
  for (const e of events) {
    const cashOut = e.modeledCost + e.stopLossAmount;
    if (e.stopLossAmount > 0 && spread) {
      spreadOutflow(monthlyOutflow, e.month, cashOut, paymentSchedule);
    } else {
      monthlyOutflow[e.month] += cashOut;
    }
    annualResidual += e.modeledCost;
    if (e.stopLossAmount > 0) {
      const reimbMonth = Math.min(11, e.month + lagMonths);
      monthlyReimbursement[reimbMonth] += e.stopLossAmount;
    }
  }

  return { monthlyOutflow, monthlyReimbursement, annualResidual, annualIndemnityOffset, annualStopLossShift, totalEvents, totalComplications, chronicEventCount, regimenMemberCount };
}

// Apply aggregate stop-loss corridor in-place: if annual residual exceeds
// `expectedResidual × aggregate_attachment_pct`, reimburse the excess at
// month 11 (final plan-year month). Returns the reimbursement amount.
//
// Note: aggregate stop-loss only helps liquidity when reimbursement arrives
// within the simulation window. Real carriers settle the following quarter,
// so this approximation is slightly aggressive — it lets the late months
// see the recovery. For a multi-year liquidity model the cross-year settle
// would matter more; for a single-year MRL it's a reasonable boundary case.
function applyAggregateStopLoss(monthlyReimbursement, annualResidual, expectedResidual, scenario) {
  if (!scenario?.aggregate_stop_loss_enabled) return 0;
  const pct = Number(scenario.aggregate_attachment_pct) || 1.25;
  if (!(pct > 0) || expectedResidual <= 0) return 0;
  const attachment = expectedResidual * pct;
  if (annualResidual <= attachment) return 0;
  const excess = annualResidual - attachment;
  monthlyReimbursement[11] += excess;
  return excess;
}

// Apply a payment schedule to a claim's cash outflow, spreading the total
// across multiple months starting at startMonth. Trailing tranches that
// fall past month 11 are clamped to month 11 (consistent with the
// reimbursement clamp) — the dollars still land within the simulation
// year, just compressed at the end.
function spreadOutflow(monthlyOutflow, startMonth, totalAmount, schedule) {
  for (let i = 0; i < schedule.length; i++) {
    const m = Math.min(11, startMonth + i);
    monthlyOutflow[m] += totalAmount * schedule[i];
  }
}

function simulateOnce(claims, monthlyContribution, lagMonths, rng, tailOverlay, paymentSchedule) {
  const monthlyOutflow = new Array(12).fill(0);
  const monthlyReimbursement = new Array(12).fill(0);

  for (const c of claims) {
    const month = Math.floor(rng() * 12);
    const residual = Number(c.residual_amount) || 0;
    const stopLoss = Number(c.stop_loss_amount) || 0;

    // Pre-Reimbursement Outflow: the employer pays both the residual portion
    // and the stop-loss-eligible portion at the time of service. Large
    // catastrophic claims (those with stop-loss exposure) spread across
    // multiple months per paymentSchedule to model adjudication delay +
    // invoice terms. Smaller cash-pay claims settle same-month. Stop-loss
    // reimbursement still arrives at month + lagMonths from incident.
    const cashOutNow = residual + stopLoss;
    if (stopLoss > 0 && paymentSchedule && paymentSchedule.length > 1) {
      spreadOutflow(monthlyOutflow, month, cashOutNow, paymentSchedule);
    } else {
      monthlyOutflow[month] += cashOutNow;
    }

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

      // Tail events that breach attachment are catastrophic-size by
      // construction; spread their outflow on the same schedule.
      if (stopLossPortion > 0 && paymentSchedule && paymentSchedule.length > 1) {
        spreadOutflow(monthlyOutflow, month, cost, paymentSchedule);
      } else {
        monthlyOutflow[month] += cost;
      }
      tailGrossOutflow += cost;

      if (stopLossPortion > 0) {
        const reimbMonth = Math.min(11, month + lagMonths);
        monthlyReimbursement[reimbMonth] += stopLossPortion;
      }
    }
  }

  // Compute the run's annual residual now (after timing-resample + tail
  // overlay outflow, before any aggregate-stop-loss reimbursement). The
  // caller may apply aggregate stop-loss to monthlyReimbursement before
  // the MRL drawdown calculation.
  let annualResidual = 0;
  for (let t = 0; t < 12; t++) {
    annualResidual += monthlyOutflow[t] - monthlyReimbursement[t];
  }

  return { monthlyOutflow, monthlyReimbursement, annualResidual, tailEventCount, tailGrossOutflow };
}

/**
 * Run a Monte Carlo to size Min Required Liquidity (MRL) for the OffPlan
 * residual + stop-loss cash flow.
 *
 * @param {object} args
 * @param {object} args.employer        Employer profile (covered_lives, current_total_healthcare_spend, id)
 * @param {object} args.scenario        Active scenario (attachment_point + name used)
 * @param {Array}  args.modeledClaims   Output of runCalculation().claims — only used when mode='timing-resample'
 * @param {object} [args.options]
 * @param {number} [args.options.runs=1000]                 Simulation count
 * @param {number} [args.options.lagMonths=3]               Stop-loss reimbursement lag in months (75 days ≈ 3)
 * @param {string} [args.options.mode='timing-resample']    'timing-resample' or 'tier-generated'
 * @param {Array}  [args.options.eventCatalog]              Override catalog for tier-generated mode (defaults to EVENT_TIER_CATALOG)
 * @param {object|false} [args.options.tailOverlay]         Catastrophic tail overlay params; only applied in timing-resample mode. Pass `false` to disable.
 * @returns {object} LiquidityResult
 */
export function simulateLiquidity({ employer, scenario, modeledClaims, options = {} }) {
  const mode = options.mode === 'tier-generated' ? 'tier-generated' : 'timing-resample';
  if (mode === 'tier-generated') {
    return simulateLiquidityTierGenerated({ employer, scenario, modeledClaims, options });
  }
  return simulateLiquidityTimingResample({ employer, scenario, modeledClaims, options });
}

function simulateLiquidityTimingResample({ employer, scenario, modeledClaims, options = {} }) {
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

  // Stop-loss claim payment schedule. Default spreads catastrophic claims
  // 1/3 / 1/3 / 1/3 across three months to model adjudication delay +
  // invoice terms. options.stopLossPaymentSchedule = [1] disables the
  // spread (single-month outflow) for sensitivity testing.
  const paymentSchedule = Array.isArray(options.stopLossPaymentSchedule)
    && options.stopLossPaymentSchedule.length > 0
    ? options.stopLossPaymentSchedule
    : STOP_LOSS_PAYMENT_SCHEDULE;

  const seed = hashSeed([
    employer?.id, scenario?.name, runs, lagMonths, attachmentPoint,
    tailOverlay ? tailOverlay.expectedCount.toFixed(4) : 'no-tail',
    paymentSchedule.length, paymentSchedule.map((x) => x.toFixed(4)).join(','),
  ]);
  const rng = mulberry32(seed);

  // Expected residual for aggregate stop-loss attachment. In timing-
  // resample mode this is the deterministic claims' residual (sum of
  // residual_amount across modeled claims) — what the engine actually
  // computed. We use it as the "expected pool" the carrier underwrote against.
  const expectedAnnualResidual = claims.reduce(
    (s, c) => s + (Number(c.residual_amount) || 0),
    0,
  );

  const mrls = new Float64Array(runs);
  let monthlyOutflowSum = 0;
  let monthlyOutflowCount = 0;
  let totalTailEvents = 0;
  let totalTailGrossOutflow = 0;
  let totalAggregateRecovery = 0;
  let runsTriggeringAggregate = 0;

  for (let i = 0; i < runs; i++) {
    const r = simulateOnce(claims, monthlyContribution, lagMonths, rng, tailOverlay, paymentSchedule);
    totalTailEvents += r.tailEventCount;
    totalTailGrossOutflow += r.tailGrossOutflow;

    // Aggregate stop-loss corridor on the realized residual.
    const recovery = applyAggregateStopLoss(r.monthlyReimbursement, r.annualResidual, expectedAnnualResidual, scenario);
    if (recovery > 0) {
      totalAggregateRecovery += recovery;
      runsTriggeringAggregate++;
    }

    // Compute MRL after all reimbursements (specific lag + aggregate at month 11).
    let required = 0;
    let cumDeficit = 0;
    for (let t = 0; t < 12; t++) {
      cumDeficit += r.monthlyOutflow[t] - monthlyContribution - r.monthlyReimbursement[t];
      if (cumDeficit > required) required = cumDeficit;
    }
    mrls[i] = required;

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

  // Bootstrap 95% CIs on each percentile. Uses a fresh PRNG seeded off
  // the main seed so the CI bounds are reproducible.
  const bootstrapRng = mulberry32((seed ^ 0xb007517a) >>> 0);
  const percentilesCi = bootstrapPercentileCIs(mrls, [50, 75, 90, 95, 99], 500, bootstrapRng);

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
    percentiles_ci: {
      p50: percentilesCi[50], p75: percentilesCi[75], p90: percentilesCi[90],
      p95: percentilesCi[95], p99: percentilesCi[99],
      bootstrap_iterations: 500,
      level: 0.95,
    },
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
    aggregate_stop_loss: scenario?.aggregate_stop_loss_enabled
      ? {
          enabled: true,
          attachment_pct: Number(scenario.aggregate_attachment_pct) || 1.25,
          expected_residual: expectedAnnualResidual,
          attachment_dollars: expectedAnnualResidual * (Number(scenario.aggregate_attachment_pct) || 1.25),
          runs_triggering: runsTriggeringAggregate,
          trigger_rate: runs > 0 ? runsTriggeringAggregate / runs : 0,
          mean_recovery_per_run: runs > 0 ? totalAggregateRecovery / runs : 0,
        }
      : { enabled: false },
    payment_schedule: {
      schedule: paymentSchedule.slice(),
      months: paymentSchedule.length,
      enabled: paymentSchedule.length > 1,
    },
    meta: {
      runs,
      horizon_months: 12,
      lag_months: lagMonths,
      seed,
      method: tailOverlay ? 'timing-resample-with-tail-overlay-v2' : 'timing-resample-v1',
      generated_at: new Date().toISOString(),
    },
  };
}

// -----------------------------------------------------------------------------
// Tier-generated mode (v2)
// -----------------------------------------------------------------------------
// Each simulation run generates a fresh population of events from the catalog
// rather than resampling the deterministic claims. This produces event-
// frequency variance on top of timing variance, which is what the spec asks
// for when sizing MRL with confidence (vs the timing-resample mode which
// holds claim count fixed at the historical year's count).
//
// We apply a simplified per-event OffPlan transformation (transformEvent
// in the helpers) instead of the full O(N log N) member-aggregating cascade.
// Trade-offs:
//   - Accuracy: per-event attachment-point math overstates stop-loss recovery
//     when a single member has multiple smaller claims that aggregate above
//     attachment. For SMB populations this delta is small (~5%); larger
//     populations see more of it.
//   - Indemnity offset: not applied. Modest understatement of residual
//     reduction. The deterministic cascade applies indemnity caps; the v2
//     simulator currently does not.
//   - Speed: ~1ms per 1000-event run on V8. 5K runs in ~500ms — fast enough
//     for interactive dashboard updates without server-side compute.
//
// Calibration is exposed as `calibration.drift_pct`. Threshold (default 10%)
// fires the UI banner when |drift| exceeds it; per-employer mix can vary
// significantly from the catalog defaults and the banner makes that visible.

function simulateLiquidityTierGenerated({ employer, scenario, modeledClaims, options = {} }) {
  const runs = Math.max(1, options.runs || 1000);
  const lagMonths = Math.max(0, options.lagMonths ?? 3);
  const catalog = Array.isArray(options.eventCatalog) && options.eventCatalog.length
    ? options.eventCatalog
    : EVENT_TIER_CATALOG;
  const lives = Math.max(1, Number(employer?.covered_lives) || 0);

  // Stop-loss claim payment schedule. Spread defaults to 1/3 over 3 months;
  // options.stopLossPaymentSchedule = [1] disables (single-month outflow).
  const paymentSchedule = Array.isArray(options.stopLossPaymentSchedule)
    && options.stopLossPaymentSchedule.length > 0
    ? options.stopLossPaymentSchedule
    : STOP_LOSS_PAYMENT_SCHEDULE;

  const seed = hashSeed([
    employer?.id,
    scenario?.name,
    runs,
    lagMonths,
    'tier-generated',
    catalog.length,
    paymentSchedule.length,
    paymentSchedule.map((x) => x.toFixed(4)).join(','),
  ]);
  const rng = mulberry32(seed);

  // Pre-compute expected annual cash flow to set the monthly contribution.
  // Mean per-event cash equivalent: depends on bucket, scenario, and tier
  // distribution mean. We use closed-form means and the simplified per-event
  // attachment split for the contribution rate. The simulator itself uses
  // member-aggregate stop-loss; this estimator over-counts stop-loss
  // recovery slightly and hence understates contribution by a small amount,
  // but the contribution rate is just a setpoint — drift between estimated
  // and realized contribution is absorbed by the cumulative drawdown.
  //
  // The closed-form must mirror the simulator's chronic-pool split and
  // complication recursion or the contribution-rate setpoint will be
  // chronically too low, inflating MRL.
  const dpcMitigation = Math.min(1, Math.max(0, Number(scenario?.dpc_clinical_mitigation_pct) || 0));
  // Resolve chronic prevalence: per-employer override wins over the
  // population default. The override is auto-estimated from classified
  // claims at ingestion time (see src/engine/calibration.js) and may be
  // manually edited via Setup.
  const employerPrevalence = Number(employer?.chronic_prevalence);
  const prevalenceFromEmployer = Number.isFinite(employerPrevalence)
    && employerPrevalence >= 0 && employerPrevalence <= 1;
  const prevalence = prevalenceFromEmployer ? employerPrevalence : CHRONIC_PREVALENCE;
  const prevalenceSource = prevalenceFromEmployer ? 'employer' : 'default';
  const chronicCount = Math.round(lives * prevalence);
  const nonchronicCount = lives - chronicCount;
  const tierMultipliers = catalog.map((tier) => {
    // Regimen-mode tiers (T10 specialty Rx) bypass the chronic-uplift +
    // complication chain — they have a deterministic event count driven
    // by the regimen-member subset and monthly fill schedule.
    if (tier.regimen_mode === 'monthly_recurrence' && chronicCount > 0) {
      const fraction = Number(tier.regimen_member_fraction) || 0;
      const fillsPerYear = Number(tier.fills_per_member_year) || 12;
      const regimenCount = Math.min(chronicCount, Math.max(0, Math.floor(lives * fraction)));
      const expectedEvents = regimenCount * fillsPerYear;
      return { tier, primaryEvents: expectedEvents, expectedEvents, effectiveUplift: 1, isRegimen: true, regimenCount };
    }
    const rawUplift = Number(CHRONIC_TIER_UPLIFT[tier.tier]) || 1;
    const effectiveUplift = 1 + (rawUplift - 1) * (1 - dpcMitigation);
    const primaryEvents =
      Number(tier.lambda_per_member_year) * (effectiveUplift * chronicCount + nonchronicCount);
    // Complication recursion (depth-capped at 3): a primary event spawns
    // expected (1 + p + p² + p³) total events including itself.
    const p = (Number(tier.complication_probability) || 0) * (1 - dpcMitigation);
    const chainFactor = 1 + p + p * p + p * p * p;
    return { tier, primaryEvents, expectedEvents: primaryEvents * chainFactor, effectiveUplift, isRegimen: false };
  });

  let expectedAnnualCashFlow = 0;
  for (const { tier, expectedEvents } of tierMultipliers) {
    const meanCost = tier.mean_cost ?? estimateTierMean(tier);
    const { residual, stopLoss } = transformEventForContribution(meanCost, tier.bucket, scenario);
    expectedAnnualCashFlow += expectedEvents * (residual + stopLoss);
  }
  const monthlyContribution = expectedAnnualCashFlow / 12;

  const indemnityBenefits = options.indemnityBenefits || DEFAULT_INDEMNITY_BENEFITS;

  // Pre-compute expected residual for the aggregate corridor. Closed-form
  // sum of (expected events × per-event residual portion).
  let expectedAnnualResidual = 0;
  for (const { tier, expectedEvents } of tierMultipliers) {
    const meanCost = tier.mean_cost ?? estimateTierMean(tier);
    const { residual } = transformEventForContribution(meanCost, tier.bucket, scenario);
    expectedAnnualResidual += expectedEvents * residual;
  }

  const mrls = new Float64Array(runs);
  const annualResiduals = new Float64Array(runs);
  let monthlyOutflowSum = 0;
  let monthlyOutflowCount = 0;
  let totalEvents = 0;
  let totalComplications = 0;
  let totalChronicEvents = 0;
  let totalRegimenMembers = 0;
  let totalAggregateRecovery = 0;
  let runsTriggeringAggregate = 0;

  for (let i = 0; i < runs; i++) {
    const r = simulateOnceFromCatalog({ catalog, lives, scenario, lagMonths, rng, indemnityBenefits, chronicPrevalence: prevalence, paymentSchedule });
    annualResiduals[i] = r.annualResidual;
    totalEvents += r.totalEvents;
    totalComplications += r.totalComplications;
    totalChronicEvents += r.chronicEventCount;
    totalRegimenMembers += r.regimenMemberCount;
    for (let t = 0; t < 12; t++) {
      monthlyOutflowSum += r.monthlyOutflow[t];
      monthlyOutflowCount++;
    }

    // Aggregate stop-loss corridor (applied in-place on monthlyReimbursement).
    const recovery = applyAggregateStopLoss(r.monthlyReimbursement, r.annualResidual, expectedAnnualResidual, scenario);
    if (recovery > 0) {
      totalAggregateRecovery += recovery;
      runsTriggeringAggregate++;
    }

    // Compute MRL for this run (same drawdown logic as timing-resample).
    let required = 0;
    let cumDeficit = 0;
    for (let t = 0; t < 12; t++) {
      cumDeficit += r.monthlyOutflow[t] - monthlyContribution - r.monthlyReimbursement[t];
      if (cumDeficit > required) required = cumDeficit;
    }
    mrls[i] = required;
  }

  const sorted = Array.from(mrls).sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p75 = percentile(sorted, 75);
  const p90 = percentile(sorted, 90);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  const meanMonthlyOutflow = monthlyOutflowCount > 0 ? monthlyOutflowSum / monthlyOutflowCount : 0;
  const meanAnnualResidual = annualResiduals.reduce((s, x) => s + x, 0) / runs;

  const bootstrapRng = mulberry32((seed ^ 0xb007517a) >>> 0);
  const percentilesCi = bootstrapPercentileCIs(mrls, [50, 75, 90, 95, 99], 500, bootstrapRng);

  // Calibration: compare simulator's mean residual to the deterministic
  // engine's residual_fund (passed in via modeledClaims). Surfaces drift
  // as a fraction; UI banner fires when |drift| > threshold.
  const deterministicResidual = (modeledClaims || []).reduce(
    (s, c) => s + (Number(c.residual_amount) || 0),
    0,
  );
  const driftPct = deterministicResidual > 0
    ? (meanAnnualResidual - deterministicResidual) / deterministicResidual
    : null;

  const elf = Number(employer?.current_total_healthcare_spend) || 0;
  const mrl = p95;

  return {
    mrl,
    cer: elf > 0 && mrl > 0 ? elf / mrl : null,
    liquidity_reduction_pct: elf > 0 && mrl > 0 ? (elf - mrl) / elf : null,
    lcr: meanMonthlyOutflow > 0 ? mrl / meanMonthlyOutflow : null,
    scr: p75 > 0 ? mrl / p75 : null,
    percentiles: { p50, p75, p90, p95, p99 },
    percentiles_ci: {
      p50: percentilesCi[50], p75: percentilesCi[75], p90: percentilesCi[90],
      p95: percentilesCi[95], p99: percentilesCi[99],
      bootstrap_iterations: 500,
      level: 0.95,
    },
    mean_monthly_outflow: meanMonthlyOutflow,
    monthly_contribution: monthlyContribution,
    annual_cash_flow: expectedAnnualCashFlow,
    elf,
    calibration: {
      simulated_mean_residual: meanAnnualResidual,
      deterministic_residual: deterministicResidual,
      drift_pct: driftPct,
      threshold_pct: 0.10,
      out_of_band: driftPct != null && Math.abs(driftPct) > 0.10,
      total_events_simulated: totalEvents,
      mean_events_per_run: totalEvents / runs,
      mean_complications_per_run: totalComplications / runs,
      complications_share_of_events: totalEvents > 0 ? totalComplications / totalEvents : 0,
    },
    chronic_clustering: {
      enabled: chronicCount > 0,
      prevalence,
      prevalence_source: prevalenceSource,
      population_default_prevalence: CHRONIC_PREVALENCE,
      chronic_lives: chronicCount,
      nonchronic_lives: nonchronicCount,
      dpc_clinical_mitigation_pct: dpcMitigation,
      mean_chronic_events_per_run: runs > 0 ? totalChronicEvents / runs : 0,
      chronic_share_of_events: totalEvents > 0 ? totalChronicEvents / totalEvents : 0,
      tier_uplifts: tierMultipliers
        .filter(({ effectiveUplift }) => effectiveUplift > 1.0001)
        .map(({ tier, effectiveUplift }) => ({
          tier: tier.tier,
          label: tier.label,
          raw_uplift: Number(CHRONIC_TIER_UPLIFT[tier.tier]) || 1,
          effective_uplift: effectiveUplift,
        })),
    },
    regimens: {
      tiers: tierMultipliers
        .filter(({ isRegimen }) => isRegimen)
        .map(({ tier, regimenCount, expectedEvents }) => {
          const meanCost = tier.mean_cost ?? estimateTierMean(tier);
          return {
            tier: tier.tier,
            label: tier.label,
            mode: tier.regimen_mode,
            members_per_run: regimenCount,
            fills_per_member: Number(tier.fills_per_member_year) || 12,
            expected_events_per_year: expectedEvents,
            expected_annual_spend: expectedEvents * meanCost,
          };
        }),
    },
    aggregate_stop_loss: scenario?.aggregate_stop_loss_enabled
      ? {
          enabled: true,
          attachment_pct: Number(scenario.aggregate_attachment_pct) || 1.25,
          expected_residual: expectedAnnualResidual,
          attachment_dollars: expectedAnnualResidual * (Number(scenario.aggregate_attachment_pct) || 1.25),
          runs_triggering: runsTriggeringAggregate,
          trigger_rate: runs > 0 ? runsTriggeringAggregate / runs : 0,
          mean_recovery_per_run: runs > 0 ? totalAggregateRecovery / runs : 0,
        }
      : { enabled: false },
    payment_schedule: {
      schedule: paymentSchedule.slice(),
      months: paymentSchedule.length,
      enabled: paymentSchedule.length > 1,
    },
    tail: { enabled: false },
    meta: {
      runs,
      horizon_months: 12,
      lag_months: lagMonths,
      seed,
      method: 'tier-generated-v5',
      catalog_length: catalog.length,
      generated_at: new Date().toISOString(),
    },
  };
}

// Closed-form mean for a tier's cost distribution. Used to estimate annual
// cash flow without running a full sampling pass.
function estimateTierMean(tier) {
  if (tier.cost_dist === 'pareto') {
    if (tier.pareto_shape > 1) {
      return tier.pareto_scale * tier.pareto_shape / (tier.pareto_shape - 1);
    }
    return tier.pareto_scale * 10; // shape <= 1: mean is undefined; use a generous floor
  }
  // Log-normal: E[X] = exp(mu + sigma^2 / 2)
  return Math.exp(tier.cost_mu + (tier.cost_sigma * tier.cost_sigma) / 2);
}

// Cache key for the storage layer. Same scenario + same claims set + same
// run count → same MRL number, so we can avoid re-running on every
// dashboard mount.
export function liquidityCacheKey(employerId, scenarioName, runs = 1000) {
  return `liquidity:${employerId}:${scenarioName}:${runs}`;
}
