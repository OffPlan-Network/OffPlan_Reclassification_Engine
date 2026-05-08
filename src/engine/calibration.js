// Per-employer calibration helpers for the stochastic layer.
//
// The tier-generated stochastic mode defaults chronic-condition prevalence
// to a population constant (CHRONIC_PREVALENCE = 0.28, anchored to CDC
// working-age data). For any specific employer that's a generic anchor —
// real populations vary substantially. When we have classified claims, we
// can derive a population-specific estimate that drives a more accurate
// MRL number.
//
// Two estimators live here:
//
//   1. estimateChronicPrevalence — utilization-pattern heuristic that
//      works on data we have today (member_id, service_date, bucket,
//      allowed_amount). No diagnosis codes required.
//
//   2. identifyExpensiveChronicMembers — stub for the production
//      condition-specific estimator that hydrates ICD-10 codes against
//      CHRONIC_CONDITION_CATALOG. Returns [] today because synthetic
//      claims don't carry diagnosis codes; production wiring listed
//      inline below.
//
// The fundamental insight: chronicity itself isn't what drives MRL —
// *expensive* chronicity is. HTN on a generic ACE inhibitor doesn't move
// MRL. Psoriatic arthritis on Cosentyx does. The condition catalog
// distinguishes these so future iterations can weight chronic uplift by
// per-condition cost band.

// ---------------------------------------------------------------------------
// estimateChronicPrevalence — utilization-pattern heuristic
// ---------------------------------------------------------------------------
//
// A member is treated as chronic if AT LEAST 2 of the following are true:
//
//   (a) Persistence: member has claims in ≥6 distinct service months.
//       Real chronic conditions (DM2, RA, MS) produce repeated touches
//       across the year — quarterly endocrinology, monthly Rx fills,
//       routine specialist follow-ups. Half-year+ utilization is a
//       strong chronic signal.
//
//   (b) Multi-touch: member has ≥4 non-Bucket-A claims in the year.
//       Filters out members who only show up for routine primary care.
//       Bucket A is excluded because DPC absorbs primary care; routine
//       healthy members may still have several A-bucket touches.
//
//   (c) Cost concentration: total non-A spend > 3× population per-member
//       non-A mean. Relative threshold (not absolute), so it scales with
//       the population's baseline utilization. Captures high utilizers
//       even when their persistence/multi-touch signals are weaker.
//
// The 2-of-3 rule with these thresholds rejects single-signal false
// positives:
//   - Single $50K outpatient surgery: meets (c) only → not chronic (acute).
//   - Member with 6 PCP visits across 6 months: meets (a), but (b) and
//     (c) require non-A activity → not chronic (just routine care).
//   - Member with 4+ specialty visits across 6+ months: meets (a) + (b),
//     usually (c) → chronic. Correctly flagged.
//
// Plausibility clamp: working-age employer populations land in a
// CDC-anchored band of roughly 10–45% chronic prevalence. If the
// heuristic returns a value outside [0.10, 0.45], the signal is
// considered unreliable (most often a synthetic-data artifact: uniform
// claim distribution makes everyone or no one look chronic) and we
// return null so the caller falls back to the population default.
//
// Real-world claims data has heavy-tailed concentration (top 5% drive
// 50% of spend) that lights up criteria (b) and (c) accurately on a
// minority of members. Synthetic uniform distributions don't, which is
// why the clamp is necessary as a safety net until a condition-aware
// estimator (identifyExpensiveChronicMembers below) replaces this.
//
// Returns a fraction in [0.10, 0.45] or null when there isn't enough
// data, or the heuristic's output is implausible.

const PERSISTENCE_MONTHS_THRESHOLD = 6;     // ≥ this many distinct months → criterion (a)
const MULTI_TOUCH_NON_A_THRESHOLD = 4;      // ≥ this many non-A claims → criterion (b)
const COST_CONCENTRATION_MULTIPLE = 3;      // non-A spend > N × mean → criterion (c)
const PLAUSIBLE_PREVALENCE_BAND = [0.10, 0.45]; // CDC working-age range

function monthOfService(claim) {
  const date = claim.service_date;
  if (!date) return null;
  // Accept YYYY-MM-DD or YYYY-MM
  return String(date).slice(0, 7);
}

export function estimateChronicPrevalence(classifiedClaims) {
  if (!Array.isArray(classifiedClaims) || classifiedClaims.length === 0) return null;

  // Fast path: when claims carry a per-claim chronic_flag (set by the
  // synthetic generator's utilization-weight quantile, or in future by
  // identifyExpensiveChronicMembers from real ICD-10 codes), prevalence
  // is just chronic_members / total_members. No heuristic needed, no
  // clamp — this is ground truth from the upstream stamping logic.
  let anyFlag = false;
  const flagsByMember = new Map();
  for (const c of classifiedClaims) {
    if (c.excluded) continue;
    const memberId = c.member_id || c.employee_id;
    if (!memberId) continue;
    if (c.chronic_flag === true || c.chronic_flag === false) anyFlag = true;
    if (c.chronic_flag === true) flagsByMember.set(memberId, true);
    else if (!flagsByMember.has(memberId)) flagsByMember.set(memberId, false);
  }
  if (anyFlag && flagsByMember.size > 0) {
    let chronic = 0;
    for (const v of flagsByMember.values()) if (v) chronic++;
    return chronic / flagsByMember.size;
  }

  // Heuristic fallback: utilization-pattern multi-criterion when claims
  // don't carry chronic_flag (e.g. raw real claims data without enrichment).
  const memberStats = new Map();
  for (const c of classifiedClaims) {
    if (c.excluded) continue;
    const memberId = c.member_id || c.employee_id;
    if (!memberId) continue;
    const entry = memberStats.get(memberId) || {
      months: new Set(),
      nonAClaimCount: 0,
      nonASpend: 0,
    };
    const month = monthOfService(c);
    if (month) entry.months.add(month);
    if (c.bucket !== 'A') {
      entry.nonAClaimCount++;
      entry.nonASpend += Number(c.allowed_amount) || 0;
    }
    memberStats.set(memberId, entry);
  }

  if (memberStats.size === 0) return null;

  // Population per-member mean of non-A spend, used for the cost-
  // concentration threshold. Mean is computed over all members who appear
  // in the claims data (not over a notional headcount), so the threshold
  // adapts to the slice we actually see.
  let totalNonASpend = 0;
  for (const [, v] of memberStats) totalNonASpend += v.nonASpend;
  const meanNonASpend = totalNonASpend / memberStats.size;
  const costThreshold = meanNonASpend * COST_CONCENTRATION_MULTIPLE;

  let chronic = 0;
  for (const [, v] of memberStats) {
    let criteriaHit = 0;
    if (v.months.size >= PERSISTENCE_MONTHS_THRESHOLD) criteriaHit++;
    if (v.nonAClaimCount >= MULTI_TOUCH_NON_A_THRESHOLD) criteriaHit++;
    if (v.nonASpend > costThreshold) criteriaHit++;
    if (criteriaHit >= 2) chronic++;
  }
  const fraction = chronic / memberStats.size;

  // Plausibility clamp — heuristic is unreliable on synthetic uniform data.
  // Returning null lets the caller fall back to CHRONIC_PREVALENCE default.
  const [lo, hi] = PLAUSIBLE_PREVALENCE_BAND;
  if (fraction < lo || fraction > hi) return null;
  return fraction;
}

// ---------------------------------------------------------------------------
// identifyExpensiveChronicMembers — stub for ICD-10 condition matching
// ---------------------------------------------------------------------------
//
// Production estimator that hydrates per-claim diagnosis codes against
// CHRONIC_CONDITION_CATALOG to produce per-member condition profiles
// with cost-band weighting. Today returns [] because synthetic claims
// don't carry ICD-10 codes; the structure below is the contract for
// when real claims data arrives.
//
// Production wiring (TODO when ICD-10 lands on claim records):
//   1. Iterate claims; for each claim's diagnosis_codes array, match
//      every code against `catalog[i].icd10_prefixes` (longest-prefix wins
//      to handle E11.9 → E11).
//   2. Aggregate matches per member: { memberId: Set<conditionId> }.
//   3. For each member, look up `expensive: true` flags in the catalog
//      and compute total annual spend on claims tagged with expensive
//      conditions (or alternatively, all spend if any expensive condition
//      is present — depends on whether claims have condition tags).
//   4. Return members with at least one expensive condition + their
//      associated annual spend.
//
// Future use:
//   - Surface "expensive chronic share" alongside overall prevalence in
//     the chronic_clustering result block.
//   - Per-condition uplift weights replacing the flat CHRONIC_TIER_UPLIFT
//     — high-cost autoimmune drives T10 specialty Rx differently than
//     HTN drives T2 specialty consults.
//
// Returns: [
//   {
//     memberId: string,
//     conditions: [{ id, name, cost_band, expensive }],
//     expensiveAnnualSpend: number,
//     hasExpensiveChronic: boolean,
//   }
// ]
export function identifyExpensiveChronicMembers(classifiedClaims, conditionCatalog) {
  if (!Array.isArray(classifiedClaims) || classifiedClaims.length === 0) return [];
  if (!Array.isArray(conditionCatalog) || conditionCatalog.length === 0) return [];

  // Synthetic claims have no diagnosis_codes field. When a real ingestion
  // path stamps c.diagnosis_codes (or c.icd10_codes), the matching logic
  // below activates. Until then we return empty — matchClaim is a no-op.
  function matchClaim(claim) {
    const codes = claim.diagnosis_codes || claim.icd10_codes;
    if (!Array.isArray(codes) || codes.length === 0) return [];
    const matches = [];
    for (const code of codes) {
      const codeStr = String(code).toUpperCase();
      // Longest-prefix-match: E11.9 → E11 wins over E (cancer prefix).
      let best = null;
      for (const cond of conditionCatalog) {
        for (const prefix of cond.icd10_prefixes) {
          if (codeStr.startsWith(prefix.toUpperCase())) {
            if (!best || prefix.length > best.prefixLen) {
              best = { cond, prefixLen: prefix.length };
            }
          }
        }
      }
      if (best) matches.push(best.cond);
    }
    return matches;
  }

  const perMember = new Map();
  for (const c of classifiedClaims) {
    if (c.excluded) continue;
    const memberId = c.member_id || c.employee_id;
    if (!memberId) continue;
    const matches = matchClaim(c);
    if (matches.length === 0) continue;
    const entry = perMember.get(memberId) || {
      memberId,
      conditions: new Map(),
      expensiveAnnualSpend: 0,
      hasExpensiveChronic: false,
    };
    for (const cond of matches) {
      entry.conditions.set(cond.id, cond);
      if (cond.expensive) entry.hasExpensiveChronic = true;
    }
    if (entry.hasExpensiveChronic) {
      entry.expensiveAnnualSpend += Number(c.allowed_amount) || 0;
    }
    perMember.set(memberId, entry);
  }

  return Array.from(perMember.values())
    .filter((e) => e.hasExpensiveChronic)
    .map((e) => ({
      memberId: e.memberId,
      conditions: Array.from(e.conditions.values()),
      expensiveAnnualSpend: e.expensiveAnnualSpend,
      hasExpensiveChronic: true,
    }));
}
