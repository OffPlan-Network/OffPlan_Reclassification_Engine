// [category, bucket, % of total spend, avg claim size, CPT, POS]
export const SYNTHETIC_DISTRIBUTION = [
  ["Primary Care",       "A", 0.10, 175,    "99213", "Office"],
  ["Lab",                "A", 0.04, 60,     "80053", "Independent Lab"],
  ["Specialist Consult", "B", 0.12, 320,    "99214", "Office"],
  ["Imaging",            "B", 0.10, 800,    "73721", "Imaging Center"],
  ["Procedures",         "B", 0.08, 2400,   "45378", "ASC"],
  ["Urgent Care",        "B", 0.04, 220,    "99203", "Urgent Care"],
  ["ER",                 "C", 0.12, 1800,   "99284", "Emergency Room"],
  ["Outpatient Surgery", "B", 0.10, 6500,   "29881", "ASC"],
  ["Inpatient",          "E", 0.18, 28000,  "99223", "Inpatient Hospital"],
  ["Specialty Rx",       "D", 0.08, 4200,   "",      "Pharmacy"],
  ["Other",              "D", 0.04, 350,    "",      "Office"],
];

const MAX_SYNTHETIC_CLAIMS = 20000;

export function generateSyntheticClaims(coveredLives, annualSpend) {
  const claims = [];
  let claimSeq = 1;
  const targetSpend = annualSpend;
  const requestedClaims = SYNTHETIC_DISTRIBUTION.reduce((total, [, , share, avgSize]) => {
    const categorySpend = targetSpend * share;
    return total + Math.max(1, Math.round(categorySpend / avgSize));
  }, 0);
  const countScale = requestedClaims > MAX_SYNTHETIC_CLAIMS ? (requestedClaims / MAX_SYNTHETIC_CLAIMS) : 1;

  SYNTHETIC_DISTRIBUTION.forEach(([category, bucket, share, avgSize, cpt, pos]) => {
    const categorySpend = targetSpend * share;
    const rawClaimCount = Math.max(1, Math.round(categorySpend / avgSize));
    const claimCount = Math.max(1, Math.round(rawClaimCount / countScale));

    for (let i = 0; i < claimCount; i++) {
      const isCatastrophic = bucket === "E" || category === "Specialty Rx";
      const memberPool = isCatastrophic ? Math.max(2, Math.floor(coveredLives * 0.05)) : coveredLives;
      const memberId = `M${String(((claimSeq + i * 7) % memberPool) + 1).padStart(4, "0")}`;

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
    },
  };
}

// Decompose category-level totals into representative claim lines.
// Used by Mode 2 CSV ingestion, Mode 2 manual entry, and the demo case
// loader so all three paths produce identically-shaped output.
export function decomposePartialSummary(rows, lives) {
  const errors = [];
  const synthClaims = [];
  let seq = 1;
  const livesEff = Number(lives) || 100;
  const fileMaxConfidence = { high: 3, medium: 2, low: 1 };
  let minConf = 3;
  let aggDataSource = null;

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
    const [, , , avgSize, cpt, pos] = rep || ["", 0, 0, 200, "99213", "11"];
    const count = Math.max(1, Math.round(spend / (avgSize || 200)));
    const claimSize = spend / count;

    for (let k = 0; k < count; k++) {
      synthClaims.push({
        claim_id: `CLM_PARTIAL_${String(seq).padStart(6, "0")}`,
        member_id: `M${String((seq % Math.max(2, livesEff)) + 1).padStart(4, "0")}`,
        service_date: row.period_end || row.period_start || "2025-06-15",
        cpt_code: cpt,
        place_of_service: pos,
        provider_specialty: cat === "Primary Care" ? "Family Medicine" : "",
        claim_type: cat === "Pharmacy" ? "Rx" : cat === "Inpatient" ? "Facility" : "Professional",
        allowed_amount: claimSize,
        drg_code: cat === "Inpatient" ? "291" : "",
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
