// Per-employer calibration helpers for the stochastic layer.
//
// The tier-generated stochastic mode defaults chronic-condition prevalence
// to a population constant (CHRONIC_PREVALENCE = 0.28, anchored to CDC
// working-age data). For any specific employer that's a generic anchor —
// real populations vary substantially. When we have classified claims, we
// can derive a population-specific estimate that drives a more accurate
// MRL number.
//
// Estimator: a member is treated as "chronic" if they appear in claims
// with either (a) at least one Bucket E event (catastrophic / inpatient
// admission, the strongest signal of unmanaged chronic exacerbation), or
// (b) more than $5,000 in cumulative non-Bucket-A spend (proxies the
// chronic-management cost burden — repeated specialist visits, imaging
// surveillance, specialty Rx). Bucket A is excluded from the dollar
// threshold because DPC absorbs primary care and we do not want a member
// who only consumes routine primary care to count as chronic.
//
// Returns a fraction in [0, 1] or null when there isn't enough data to
// compute (no claims, or no claims with member identifiers).

const NON_A_SPEND_THRESHOLD = 5000;

export function estimateChronicPrevalence(classifiedClaims) {
  if (!Array.isArray(classifiedClaims) || classifiedClaims.length === 0) return null;

  const memberStats = new Map();
  for (const c of classifiedClaims) {
    if (c.excluded) continue;
    const memberId = c.employee_id || c.member_id;
    if (!memberId) continue;
    const entry = memberStats.get(memberId) || { totalNonA: 0, hasE: false };
    if (c.bucket === 'E') entry.hasE = true;
    if (c.bucket !== 'A') entry.totalNonA += Number(c.allowed_amount) || 0;
    memberStats.set(memberId, entry);
  }

  if (memberStats.size === 0) return null;

  let chronic = 0;
  for (const [, v] of memberStats) {
    if (v.hasE || v.totalNonA > NON_A_SPEND_THRESHOLD) chronic++;
  }
  return chronic / memberStats.size;
}
