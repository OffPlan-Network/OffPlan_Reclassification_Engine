const cptInRange = (cpt, lo, hi) => {
  if (!cpt) return false;
  const cptStr = String(cpt).trim().toUpperCase();
  const loStr = String(lo).toUpperCase();
  const hiStr = String(hi).toUpperCase();
  return cptStr >= loStr && cptStr <= hiStr;
};

export const findCPTRule = (cpt, rules) => {
  if (!cpt) return null;
  for (const rule of rules) {
    if (cptInRange(cpt, rule.range[0], rule.range[1])) return rule;
  }
  return null;
};

// Bucket assignment with POS/specialty/CPT precedence
export function normalizeAndClassify(claim, cptRules) {
  const cpt = claim.cpt_code ? String(claim.cpt_code).trim() : "";
  const pos = claim.place_of_service ? String(claim.place_of_service).trim() : "";
  const specialty = claim.provider_specialty ? String(claim.provider_specialty).trim() : "";
  const drg = claim.drg_code ? String(claim.drg_code).trim() : "";

  if (drg || /inpatient/i.test(pos)) {
    return { category: "Inpatient", bucket: "E", confidence: "high", source: "POS/DRG" };
  }

  if (/^er$|emergency/i.test(pos)) {
    return { category: "ER", bucket: "C", confidence: "high", source: "POS=ER" };
  }

  if (/urgent/i.test(pos)) {
    return { category: "Urgent Care", bucket: "B", confidence: "high", source: "POS=UC" };
  }

  if (/asc|ambulatory/i.test(pos)) {
    const rule = findCPTRule(cpt, cptRules);
    if (rule) return { category: rule.category, bucket: rule.bucket, confidence: "high", source: `CPT ${cpt}` };
    return { category: "ASC Procedure", bucket: "B", confidence: "medium", source: "POS=ASC" };
  }

  const rule = findCPTRule(cpt, cptRules);
  if (rule) {
    if (rule.category === "Primary Care" && specialty &&
        !/family|primary|internal|pediatric|geriatric/i.test(specialty)) {
      return { category: "Specialist Consult", bucket: "B", confidence: "high", source: `Specialty=${specialty}` };
    }
    return { category: rule.category, bucket: rule.bucket, confidence: "high", source: `CPT ${cpt}` };
  }

  if (claim.claim_type && /rx|pharmacy/i.test(claim.claim_type)) {
    return { category: "Specialty Rx", bucket: "D", confidence: "medium", source: "Rx" };
  }

  return { category: "Other", bucket: "D", confidence: "low", source: "Unmapped" };
}
