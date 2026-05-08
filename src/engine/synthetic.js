// [category, bucket, % of total spend, avg claim size, CPT, POS]
//
// Distribution calibrated against typical SMB benchmarks (Milliman Group Cost
// Guidelines, SOA Group Health Cost Model). Shares and avg claim sizes track
// real-world allowed amounts at 200-300% of Medicare reference pricing — the
// pricing reality the OffPlan cash-pay network is designed to attack.
export const SYNTHETIC_DISTRIBUTION = [
  ["Primary Care",       "A", 0.08, 175,    "99213", "Office"],
  ["Lab",                "A", 0.04, 60,     "80053", "Independent Lab"],
  ["Specialist Consult", "B", 0.10, 320,    "99214", "Office"],
  ["Imaging",            "B", 0.08, 1600,   "73721", "Imaging Center"],
  ["Procedures",         "B", 0.08, 4800,   "45378", "ASC"],
  ["Urgent Care",        "B", 0.04, 220,    "99203", "Urgent Care"],
  ["ER",                 "C", 0.08, 1800,   "99284", "Emergency Room"],
  ["Outpatient Surgery", "B", 0.12, 6500,   "29881", "ASC"],
  ["Inpatient",          "E", 0.20, 28000,  "99223", "Inpatient Hospital"],
  ["Specialty Rx",       "D", 0.16, 4200,   "",      "Pharmacy"],
  ["Other",              "D", 0.02, 350,    "",      "Office"],
];

const MAX_SYNTHETIC_CLAIMS = 20000;

// Log-normal sigma controlling per-member utilization heterogeneity. With
// sigma=1.0 (mu=0): median weight 1.0, mean ~1.65, P95 ~5.2, P99 ~10.2.
// This produces a heavy-tailed distribution where ~5% of members drive
// half of cost — the empirical concentration pattern in real claims data
// (Milliman utilization curves, MEPS HCUP). Without this weighting the
// synthetic generator distributed claims uniformly, which made the
// chronic-prevalence heuristic mis-fire on every demo (see
// src/engine/calibration.js).
const UTIL_LOGNORMAL_SIGMA = 1.0;

// Members in the top this fraction by utilization weight are flagged
// chronic at generation time. Anchored to CDC working-age chronic-condition
// prevalence (~28%). The chronic_flag stamped here replaces the post-hoc
// heuristic the engine used to apply.
const CHRONIC_TOP_FRACTION = 0.28;

// Catastrophic events restrict to the top this fraction by weight. Was 0.05
// historically (a fixed 5% pool) and stays there — catastrophic events
// concentrate even more tightly than chronic conditions; the highest-weight
// 5% of members realistically own all bucket-E activity in a given year.
const CATASTROPHIC_TOP_FRACTION = 0.05;

// Box-Muller log-normal sampler. Uses Math.random so the seeded mulberry32
// in scripts/generate-demo-claims.mjs flows through unchanged.
function sampleLogNormal(sigma) {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(sigma * z);
}

// Build a per-member utilization weight pool with heavy-tailed sampling
// and pre-computed CDFs for fast weighted member selection. Returns:
//   - weights[i]            log-normal weight for member i
//   - generalCdf[i]          cumulative weight (general pool)
//   - catastrophicIndices[]  indices of top CATASTROPHIC_TOP_FRACTION by weight
//   - catastrophicCdf[i]     cumulative weight within catastrophic pool
//   - chronicIndices         Set<int> indices of top CHRONIC_TOP_FRACTION by weight
//   - pickGeneral()          weighted pick from general pool
//   - pickCatastrophic()     weighted pick from catastrophic top
function buildMemberPool(coveredLives) {
  const weights = new Array(coveredLives);
  for (let i = 0; i < coveredLives; i++) weights[i] = sampleLogNormal(UTIL_LOGNORMAL_SIGMA);

  let totalWeight = 0;
  for (let i = 0; i < coveredLives; i++) totalWeight += weights[i];
  const generalCdf = new Array(coveredLives);
  let acc = 0;
  for (let i = 0; i < coveredLives; i++) {
    acc += weights[i] / totalWeight;
    generalCdf[i] = acc;
  }

  const sortedByWeightDesc = weights
    .map((w, i) => [w, i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);

  const catastrophicCount = Math.max(2, Math.floor(coveredLives * CATASTROPHIC_TOP_FRACTION));
  const catastrophicIndices = sortedByWeightDesc.slice(0, catastrophicCount);
  let catTotalWeight = 0;
  for (const idx of catastrophicIndices) catTotalWeight += weights[idx];
  const catastrophicCdf = new Array(catastrophicCount);
  acc = 0;
  for (let k = 0; k < catastrophicCount; k++) {
    acc += weights[catastrophicIndices[k]] / catTotalWeight;
    catastrophicCdf[k] = acc;
  }

  const chronicCount = Math.max(1, Math.floor(coveredLives * CHRONIC_TOP_FRACTION));
  const chronicIndices = new Set(sortedByWeightDesc.slice(0, chronicCount));

  function binarySearchCdf(cdf, r) {
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < r) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  return {
    weights,
    chronicIndices,
    pickGeneral() {
      return binarySearchCdf(generalCdf, Math.random());
    },
    pickCatastrophic() {
      return catastrophicIndices[binarySearchCdf(catastrophicCdf, Math.random())];
    },
  };
}

export function generateSyntheticClaims(coveredLives, annualSpend) {
  const claims = [];
  let claimSeq = 1;
  const targetSpend = annualSpend;
  const requestedClaims = SYNTHETIC_DISTRIBUTION.reduce((total, [, , share, avgSize]) => {
    const categorySpend = targetSpend * share;
    return total + Math.max(1, Math.round(categorySpend / avgSize));
  }, 0);
  const countScale = requestedClaims > MAX_SYNTHETIC_CLAIMS ? (requestedClaims / MAX_SYNTHETIC_CLAIMS) : 1;

  // Per-member utilization weights for this run. Heavy-tailed log-normal
  // produces realistic concentration: a small subset of members accumulates
  // most of the non-routine claims, matching real-world utilization curves.
  const pool = buildMemberPool(coveredLives);

  SYNTHETIC_DISTRIBUTION.forEach(([category, bucket, share, avgSize, cpt, pos]) => {
    const categorySpend = targetSpend * share;
    const rawClaimCount = Math.max(1, Math.round(categorySpend / avgSize));
    const claimCount = Math.max(1, Math.round(rawClaimCount / countScale));

    for (let i = 0; i < claimCount; i++) {
      const isCatastrophic = bucket === "E" || category === "Specialty Rx";
      // Bucket A (Primary Care, Lab) stays uniformly distributed —
      // routine preventive care is a population-wide phenomenon, not a
      // utilization-weighted one. Everything else samples from the
      // weighted pool so heavy-utilizers accumulate non-routine claims.
      let memberIdx;
      if (isCatastrophic) {
        memberIdx = pool.pickCatastrophic();
      } else if (bucket === "A") {
        memberIdx = (claimSeq + i * 7) % coveredLives;
      } else {
        memberIdx = pool.pickGeneral();
      }
      const memberId = `M${String(memberIdx + 1).padStart(4, "0")}`;
      const isChronicMember = pool.chronicIndices.has(memberIdx);

      const variance = 0.5 + Math.random();
      const amount = Math.round(avgSize * variance * countScale);

      claims.push({
        claim_id: `CLM${String(claimSeq).padStart(6, "0")}`,
        member_id: memberId,
        service_date: new Date(2025, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1)
          .toISOString().slice(0, 10),
        cpt_code: cpt,
        place_of_service: pos,
        provider_specialty: category === "Specialist Consult" ? "Cardiology" :
                            category === "Primary Care" ? "Family Medicine" : "",
        claim_type: category === "Specialty Rx" ? "Rx" :
                    category === "Inpatient" ? "Facility" : "Professional",
        allowed_amount: amount,
        drg_code: category === "Inpatient" ? "291" : "",
        // Stamped at generation time from the member's utilization-weight
        // rank (top CHRONIC_TOP_FRACTION = chronic). Replaces the post-hoc
        // heuristic in App.jsx:312 for synthetic data; real ingestion still
        // relies on diagnosis-code-aware identification (see
        // src/engine/calibration.js → identifyExpensiveChronicMembers).
        chronic_flag: isChronicMember,
        _synthetic: true,
      });
      claimSeq++;
    }
  });

  return {
    claims,
    meta: {
      requestedClaims,
      generatedClaims: claims.length,
      wasCapped: requestedClaims > MAX_SYNTHETIC_CLAIMS,
      chronicMemberCount: pool.chronicIndices.size,
      coveredLives,
    },
  };
}

// Decompose category-level totals into representative claim lines.
// Used by Mode 2 CSV ingestion, Mode 2 manual entry, and the demo case
// loader so all three paths produce identically-shaped output.
//
// Member assignment uses the same heavy-tailed log-normal weighting as
// generateSyntheticClaims so the auto-estimator and chronic-clustering
// simulator see realistic per-member concentration on Mode 2 data.
// Bucket A claims still spread uniformly (preventive care is population-
// wide); everything else samples from the weighted pool.
export function decomposePartialSummary(rows, lives) {
  const errors = [];
  const synthClaims = [];
  let seq = 1;
  const livesEff = Number(lives) || 100;
  const fileMaxConfidence = { high: 3, medium: 2, low: 1 };
  let minConf = 3;
  let aggDataSource = null;

  // Build the weighted member pool once for the whole decomposition.
  const pool = buildMemberPool(livesEff);

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const cat = (row.claims_category || row.category || "").trim();
    const spend = parseFloat(row.annual_spend);
    if (!cat) { errors.push(`Row ${rowNum}: missing claims_category`); return; }
    if (isNaN(spend) || spend < 0) { errors.push(`Row ${rowNum}: invalid annual_spend`); return; }
    const conf = (row.confidence_level || "medium").toLowerCase();
    if (fileMaxConfidence[conf]) minConf = Math.min(minConf, fileMaxConfidence[conf]);
    aggDataSource = aggDataSource || row.data_source;

    const rep = SYNTHETIC_DISTRIBUTION.find(([c]) => c.toLowerCase() === cat.toLowerCase());
    const [, bucket, , avgSize, cpt, pos] = rep || ["", "D", 0, 200, "99213", "11"];
    const count = Math.max(1, Math.round(spend / (avgSize || 200)));
    const claimSize = spend / count;
    const isCatastrophic = bucket === "E" || cat.toLowerCase() === "specialty rx" || cat.toLowerCase() === "pharmacy";

    for (let k = 0; k < count; k++) {
      let memberIdx;
      if (isCatastrophic) {
        memberIdx = pool.pickCatastrophic();
      } else if (bucket === "A") {
        memberIdx = (seq + k * 7) % livesEff;
      } else {
        memberIdx = pool.pickGeneral();
      }
      const memberId = `M${String(memberIdx + 1).padStart(4, "0")}`;
      const isChronicMember = pool.chronicIndices.has(memberIdx);

      synthClaims.push({
        claim_id: `CLM_PARTIAL_${String(seq).padStart(6, "0")}`,
        member_id: memberId,
        service_date: row.period_end || row.period_start || "2025-06-15",
        cpt_code: cpt,
        place_of_service: pos,
        provider_specialty: cat === "Primary Care" ? "Family Medicine" : "",
        claim_type: cat === "Pharmacy" ? "Rx" : cat === "Inpatient" ? "Facility" : "Professional",
        allowed_amount: claimSize,
        drg_code: cat === "Inpatient" ? "291" : "",
        chronic_flag: isChronicMember,
        _from_summary: true,
        _summary_category: cat,
        _summary_source_row: rowNum,
      });
      seq++;
    }
  });

  const confidence = minConf === 3 ? "high" : minConf === 2 ? "medium" : "low";
  return {
    claims: synthClaims,
    errors,
    confidence,
    data_source: aggDataSource || "broker_report",
  };
}
