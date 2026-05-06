import { fmtUSD, fmtPct } from '../ui/formatters.js';

// Mandatory cascade order: DPC → Repricing → Indemnity → Stop-loss → Residual
export function runCalculation(claims, scenario, cashPrices, indemnityBenefits, repriceFactors) {
  const modeled = claims.map((c) => {
    const result = {
      ...c,
      modeled_cost: 0,
      indemnity_offset: 0,
      stop_loss_amount: 0,
      residual_amount: 0,
      transformation: "",
    };

    const allowed = Number(c.allowed_amount) || 0;
    const bucket = c.bucket;
    const category = c.normalized_category;

    if (bucket === "A") {
      const eliminatedFraction = scenario.dpc_elimination_pct;
      result.modeled_cost = allowed * (1 - eliminatedFraction);
      result.transformation = `DPC eliminates ${fmtPct(eliminatedFraction, 0)}`;
    } else if (bucket === "B") {
      const cashPrice = cashPrices[c.cpt_code];
      if (cashPrice !== undefined) {
        result.modeled_cost = Math.min(cashPrice, allowed);
        result.transformation = `Cash price ${fmtUSD(cashPrice)}`;
      } else {
        const factor = repriceFactors[category] ?? scenario.cashpay_discount_factor;
        result.modeled_cost = allowed * factor;
        result.transformation = `Repriced @ ${fmtPct(factor, 0)}`;
      }
      if (category === "Urgent Care") {
        const remaining = 1 - scenario.urgent_care_reduction_pct;
        result.modeled_cost *= remaining;
        result.transformation += ` (UC reduced ${fmtPct(scenario.urgent_care_reduction_pct, 0)})`;
      }
    } else if (bucket === "C") {
      const reducedAllowed = allowed * (1 - scenario.er_reduction_pct);
      result.modeled_cost = reducedAllowed;
      result.transformation = `ER reduced ${fmtPct(scenario.er_reduction_pct, 0)}`;
    } else if (bucket === "E") {
      result.modeled_cost = allowed;
      result.transformation = "Catastrophic";
    } else {
      result.modeled_cost = allowed;
      result.transformation = "Residual default";
    }

    return result;
  });

  // Indemnity offset (bucket C and high-cost imaging/procedures)
  if (scenario.indemnity_enabled) {
    const memberUsage = {};
    modeled.forEach((c) => {
      const m = c.member_id;
      if (!memberUsage[m]) memberUsage[m] = {};
    });

    const sorted = [...modeled].sort((a, b) => (Number(b.modeled_cost) || 0) - (Number(a.modeled_cost) || 0));
    sorted.forEach((c) => {
      let eventType = null;
      if (c.bucket === "C" && c.normalized_category === "ER") eventType = "ER";
      else if (c.normalized_category === "Inpatient") eventType = "Hospital Admission";
      else if (c.normalized_category === "Imaging" && c.modeled_cost > 200) eventType = "Imaging";
      else if (c.normalized_category === "Outpatient Surgery") eventType = "Outpatient Surgery";
      else if (c.normalized_category === "Procedures" && c.modeled_cost > 1000) eventType = "Outpatient Surgery";

      if (eventType && indemnityBenefits[eventType]) {
        const ind = indemnityBenefits[eventType];
        const usage = memberUsage[c.member_id][eventType] || 0;
        if (usage < ind.maxPerYear) {
          const offset = Math.min(ind.benefit, c.modeled_cost);
          c.indemnity_offset = offset;
          c.modeled_cost = Math.max(0, c.modeled_cost - offset);
          memberUsage[c.member_id][eventType] = usage + 1;
        }
      }
    });
  }

  // Stop-loss split: aggregate at member level FIRST
  const memberTotals = {};
  modeled.forEach((c) => {
    if (!memberTotals[c.member_id]) memberTotals[c.member_id] = 0;
    memberTotals[c.member_id] += Number(c.modeled_cost) || 0;
  });

  Object.keys(memberTotals).forEach((memberId) => {
    const total = memberTotals[memberId];
    if (total > scenario.attachment_point) {
      const overage = total - scenario.attachment_point;
      const memberClaims = modeled.filter((c) => c.member_id === memberId);
      memberClaims.sort((a, b) => (Number(b.modeled_cost) || 0) - (Number(a.modeled_cost) || 0));
      let remaining = overage;
      for (const c of memberClaims) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(c.modeled_cost) || 0);
        c.stop_loss_amount = take;
        c.modeled_cost = (Number(c.modeled_cost) || 0) - take;
        remaining -= take;
      }
    }
  });

  // Residual = whatever's left
  modeled.forEach((c) => {
    c.residual_amount = Number(c.modeled_cost) || 0;
  });

  const sum = (arr, key) => arr.reduce((s, x) => s + (Number(x[key]) || 0), 0);
  const sumCustom = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

  const historical_claims = sum(modeled, "allowed_amount");

  const dpc_eliminated = sumCustom(modeled, (c) => {
    if (c.bucket !== "A") return 0;
    return (Number(c.allowed_amount) || 0) * scenario.dpc_elimination_pct;
  });

  const repriced_savings = sumCustom(modeled, (c) => {
    if (c.bucket !== "B") return 0;
    const allowed = Number(c.allowed_amount) || 0;
    const finalSpend = (Number(c.residual_amount) || 0) + (Number(c.stop_loss_amount) || 0) + (Number(c.indemnity_offset) || 0);
    return Math.max(0, allowed - finalSpend);
  });

  const er_reduction_savings = sumCustom(modeled, (c) => {
    if (c.bucket !== "C") return 0;
    return (Number(c.allowed_amount) || 0) * scenario.er_reduction_pct;
  });

  const indemnity_offset = sum(modeled, "indemnity_offset");
  const stop_loss_shift = sum(modeled, "stop_loss_amount");
  const residual_fund = sum(modeled, "residual_amount");

  return {
    claims: modeled,
    aggregates: {
      historical_claims,
      dpc_eliminated,
      repriced_savings,
      er_reduction_savings,
      indemnity_offset,
      stop_loss_shift,
      residual_fund,
    },
  };
}
