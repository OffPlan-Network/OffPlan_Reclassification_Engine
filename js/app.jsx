const { useState, useEffect, useMemo, useRef } = React;
const Papa = window.Papa;

// lucide-react compatible icon components — render via lucide.createElement
function makeLucideIcon(iconName) {
  return function LucideIcon({ size = 24, strokeWidth = 2, className = "", color = "currentColor", ...props }) {
    const ref = useRef(null);
    useEffect(() => {
      if (ref.current) {
        ref.current.innerHTML = "";
        const iconNode = lucide.icons[iconName];
        if (iconNode) {
          const svg = lucide.createElement(iconNode);
          svg.setAttribute("width", size);
          svg.setAttribute("height", size);
          svg.setAttribute("stroke-width", strokeWidth);
          svg.setAttribute("class", className);
          svg.style.color = color;
          ref.current.appendChild(svg);
        }
      }
    }, [size, strokeWidth, className, color]);
    return <span ref={ref} style={{ display: "inline-flex" }} {...props} />;
  };
}

const Upload = makeLucideIcon("Upload");
const FileText = makeLucideIcon("FileText");
const Sliders = makeLucideIcon("Sliders");
const BarChart3 = makeLucideIcon("BarChart3");
const Building2 = makeLucideIcon("Building2");
const Plus = makeLucideIcon("Plus");
const ArrowRight = makeLucideIcon("ArrowRight");
const Download = makeLucideIcon("Download");
const RefreshCw = makeLucideIcon("RefreshCw");
const AlertCircle = makeLucideIcon("AlertCircle");
const Check = makeLucideIcon("Check");
const X = makeLucideIcon("X");
const Trash2 = makeLucideIcon("Trash2");
const Eye = makeLucideIcon("Eye");
const ChevronRight = makeLucideIcon("ChevronRight");
const TrendingDown = makeLucideIcon("TrendingDown");
const Zap = makeLucideIcon("Zap");
const Shield = makeLucideIcon("Shield");
const AlertTriangle = makeLucideIcon("AlertTriangle");
const Database = makeLucideIcon("Database");
const Settings = makeLucideIcon("Settings");
const FileDown = makeLucideIcon("FileDown");
const Layers = makeLucideIcon("Layers");
const Activity = makeLucideIcon("Activity");
const DollarSign = makeLucideIcon("DollarSign");
const Users = makeLucideIcon("Users");
const Calendar = makeLucideIcon("Calendar");
const MapPin = makeLucideIcon("MapPin");
const Target = makeLucideIcon("Target");
const Edit3 = makeLucideIcon("Edit3");

// In-memory storage shim (replaces window.storage which is Claude Artifact-only)
window.storage = {
  _store: {},
  async get(key) { return this._store[key] !== undefined ? { key, value: this._store[key], shared: false } : null; },
  async set(key, value) { this._store[key] = value; return { key, value, shared: false }; },
  async delete(key) { delete this._store[key]; return { key, deleted: true, shared: false }; },
  async list(prefix = "") { return { keys: Object.keys(this._store).filter(k => k.startsWith(prefix)), prefix, shared: false }; },
};




/* =====================================================================
 *  OFFPLAN CLAIMS RECLASSIFICATION ENGINE — MVP
 *  ---------------------------------------------------------------------
 *  Strategic purpose: Prove with employer data that under OffPlan,
 *  the majority of historical claims are no longer claims at all.
 *
 *  This is NOT a level-funded plan calculator.
 *  Output is RESIDUAL CLAIMS FUND (PEPM), not "expected claims".
 * ===================================================================== */

/* ---------------------------------------------------------------------
 *  REFERENCE DATA — CPT mapping, cash-pay rates, indemnity benefits
 *  These are exposed in the Admin layer and editable per the spec.
 * ------------------------------------------------------------------- */

// Default CPT mapping rules — covers the high-volume codes
// Bucket: A=DPC eliminated, B=Cash-pay repriced, C=Indemnity offset,
//          D=Residual fund, E=Stop-loss
const {
  DEFAULT_CPT_RULES,
  DEFAULT_CASH_PRICES,
  DEFAULT_REPRICE_FACTORS,
  DEFAULT_INDEMNITY_BENEFITS,
  SCENARIO_PRESETS,
  OFFPLAN_MEMBERSHIP_PEPM,
  TPA_PEPM,
  INPUT_MODES,
  CONFIDENCE_LEVELS,
  ASSUMPTION_SOURCES,
  DATA_SOURCES,
  INITIAL_PRICING_VERSION,
  INITIAL_RULE_VERSION,
  INITIAL_INDEMNITY_VERSION,
  INITIAL_BENCHMARK_VERSION,
  CONF_COLOR
} = window.APP_CONSTANTS;




/* ---------------------------------------------------------------------
 *  HELPERS
 * ------------------------------------------------------------------- */

const fmtUSD = (n, decimals = 0) => {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

const fmtNum = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
};

const fmtPct = (n, decimals = 1) => {
  if (n === null || n === undefined || isNaN(n)) return "0%";
  return `${(n * 100).toFixed(decimals)}%`;
};

/* ---------------------------------------------------------------------
 *  PROVENANCE UI COMPONENTS
 * ------------------------------------------------------------------- */

function InputModeBadge({ inputModeRecord, inline = false }) {
  if (!inputModeRecord) return null;
  const m = INPUT_MODES[inputModeRecord.mode?.toUpperCase()] || { label: inputModeRecord.mode, confidence: "low" };
  const colors = {
    high:   { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-200", dot: "bg-emerald-500" },
    medium: { bg: "bg-amber-50",   text: "text-amber-800",   border: "border-amber-200",   dot: "bg-amber-500" },
    low:    { bg: "bg-rose-50",    text: "text-rose-800",    border: "border-rose-200",    dot: "bg-rose-500" },
  }[inputModeRecord.confidence_override || m.confidence] || { bg: "bg-stone-50", text: "text-stone-700", border: "border-stone-200", dot: "bg-stone-400" };
  return (
    <span className={`${colors.bg} ${colors.text} ${colors.border} border ${inline ? "inline-flex" : "flex"} items-center gap-1.5 text-[11px] uppercase tracking-wider px-2 py-1 rounded font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {m.label} · {(inputModeRecord.confidence_override || m.confidence)} confidence
    </span>
  );
}

function ProvenanceFooter({ inputModeRecord, pricingVersion, ruleVersion, indemnityVersion, benchmarkVersion, scenario, claims, compact = false }) {
  if (!inputModeRecord && !pricingVersion) return null;
  const m = inputModeRecord ? (INPUT_MODES[inputModeRecord.mode?.toUpperCase()] || { label: inputModeRecord.mode }) : null;
  const overrideCount = (claims || []).filter((c) => c.manual_override).length;
  const lines = [
    { label: "Mode", value: m ? m.label : "Unknown" },
    { label: "Confidence", value: inputModeRecord ? (inputModeRecord.confidence_override || m.confidence) + (inputModeRecord.confidence_override ? " (user-overridden)" : "") : "—" },
    { label: "Pricing", value: pricingVersion ? `${pricingVersion.version_label} · effective ${new Date(pricingVersion.effective_at).toISOString().slice(0,10)}` : "—" },
    { label: "Rules", value: ruleVersion ? `${ruleVersion.version_label} · effective ${new Date(ruleVersion.effective_at).toISOString().slice(0,10)}` : "—" },
    { label: "Indemnity", value: indemnityVersion ? `${indemnityVersion.version_label}` : "—" },
    ...(inputModeRecord?.mode === "modeled" && benchmarkVersion ? [{ label: "Benchmark", value: benchmarkVersion.version_label }] : []),
    { label: "Scenario", value: scenario?.name ? `${scenario.name}` : "—" },
    { label: "Overrides", value: overrideCount > 0 ? `${overrideCount} manual override${overrideCount === 1 ? "" : "s"} applied` : "none" },
  ];

  if (compact) {
    return (
      <div className="text-[10px] text-stone-500 leading-relaxed">
        {lines.map((l, i) => (
          <span key={i}>
            <span className="font-medium text-stone-600">{l.label}:</span> {l.value}
            {i < lines.length - 1 ? "  ·  " : ""}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="border-t border-stone-200 pt-4 mt-6">
      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-2">Provenance</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
        {lines.map((l, i) => (
          <div key={i}>
            <div className="text-stone-500 uppercase tracking-wider">{l.label}</div>
            <div className="text-stone-800 font-mono">{l.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


const cptInRange = (cpt, lo, hi) => {
  if (!cpt) return false;
  // Handle alpha prefixes (G0438, etc.)
  const cptStr = String(cpt).trim().toUpperCase();
  const loStr = String(lo).toUpperCase();
  const hiStr = String(hi).toUpperCase();
  return cptStr >= loStr && cptStr <= hiStr;
};

// Find matching rule for a CPT code
const findCPTRule = (cpt, rules) => {
  if (!cpt) return null;
  for (const rule of rules) {
    if (cptInRange(cpt, rule.range[0], rule.range[1])) return rule;
  }
  return null;
};

/* ---------------------------------------------------------------------
 *  NORMALIZATION + BUCKET ASSIGNMENT
 * ------------------------------------------------------------------- */

function normalizeAndClassify(claim, cptRules) {
  const cpt = claim.cpt_code ? String(claim.cpt_code).trim() : "";
  const pos = claim.place_of_service ? String(claim.place_of_service).trim() : "";
  const specialty = claim.provider_specialty ? String(claim.provider_specialty).trim() : "";
  const drg = claim.drg_code ? String(claim.drg_code).trim() : "";

  // Inpatient takes precedence — DRG present or POS = Inpatient
  if (drg || /inpatient/i.test(pos)) {
    return { category: "Inpatient", bucket: "E", confidence: "high", source: "POS/DRG" };
  }

  // ER place of service
  if (/^er$|emergency/i.test(pos)) {
    return { category: "ER", bucket: "C", confidence: "high", source: "POS=ER" };
  }

  // Urgent care
  if (/urgent/i.test(pos)) {
    return { category: "Urgent Care", bucket: "B", confidence: "high", source: "POS=UC" };
  }

  // ASC
  if (/asc|ambulatory/i.test(pos)) {
    // Will get bucket from CPT rule if available; otherwise default to repriced
    const rule = findCPTRule(cpt, cptRules);
    if (rule) return { category: rule.category, bucket: rule.bucket, confidence: "high", source: `CPT ${cpt}` };
    return { category: "ASC Procedure", bucket: "B", confidence: "medium", source: "POS=ASC" };
  }

  // CPT-based classification
  const rule = findCPTRule(cpt, cptRules);
  if (rule) {
    // Specialty override: if E/M code (99201-99215) but specialty is NOT primary care
    if (rule.category === "Primary Care" && specialty &&
        !/family|primary|internal|pediatric|geriatric/i.test(specialty)) {
      return { category: "Specialist Consult", bucket: "B", confidence: "high", source: `Specialty=${specialty}` };
    }
    return { category: rule.category, bucket: rule.bucket, confidence: "high", source: `CPT ${cpt}` };
  }

  // Pharmacy
  if (claim.claim_type && /rx|pharmacy/i.test(claim.claim_type)) {
    return { category: "Specialty Rx", bucket: "D", confidence: "medium", source: "Rx" };
  }

  // Default — flag for review
  return { category: "Other", bucket: "D", confidence: "low", source: "Unmapped" };
}

/* ---------------------------------------------------------------------
 *  CALCULATION ENGINE
 *  Mandatory order: DPC → Repricing → Indemnity → Stop-loss → Residual
 * ------------------------------------------------------------------- */

function runCalculation(claims, scenario, cashPrices, indemnityBenefits, repriceFactors) {
  // First pass: compute modeled_cost per claim line
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
      // DPC eliminated — partial elimination per scenario
      const eliminatedFraction = scenario.dpc_elimination_pct;
      result.modeled_cost = allowed * (1 - eliminatedFraction);
      result.transformation = `DPC eliminates ${fmtPct(eliminatedFraction, 0)}`;
    } else if (bucket === "B") {
      // Cash-pay repricing — exact lookup OR factor
      const cashPrice = cashPrices[c.cpt_code];
      if (cashPrice !== undefined) {
        result.modeled_cost = Math.min(cashPrice, allowed);
        result.transformation = `Cash price ${fmtUSD(cashPrice)}`;
      } else {
        const factor = repriceFactors[category] ?? scenario.cashpay_discount_factor;
        result.modeled_cost = allowed * factor;
        result.transformation = `Repriced @ ${fmtPct(factor, 0)}`;
      }
      // Apply urgent care reduction if applicable
      if (category === "Urgent Care") {
        const remaining = 1 - scenario.urgent_care_reduction_pct;
        result.modeled_cost *= remaining;
        result.transformation += ` (UC reduced ${fmtPct(scenario.urgent_care_reduction_pct, 0)})`;
      }
    } else if (bucket === "C") {
      // ER / indemnity offset events
      // First apply ER reduction (DPC prevents avoidable ER)
      let reducedAllowed = allowed * (1 - scenario.er_reduction_pct);
      result.modeled_cost = reducedAllowed;
      result.transformation = `ER reduced ${fmtPct(scenario.er_reduction_pct, 0)}`;
    } else if (bucket === "E") {
      // Catastrophic / inpatient — full allowed flows to stop-loss/residual split
      result.modeled_cost = allowed;
      result.transformation = "Catastrophic";
    } else {
      // Bucket D — Residual default
      result.modeled_cost = allowed;
      result.transformation = "Residual default";
    }

    return result;
  });

  // Second pass: indemnity offsets (per spec — applied to bucket C and high-cost imaging/procedures)
  if (scenario.indemnity_enabled) {
    // Track usage per member to respect maxPerYear
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

  // Third pass: stop-loss split (must aggregate at member level FIRST)
  const memberTotals = {};
  modeled.forEach((c) => {
    if (!memberTotals[c.member_id]) memberTotals[c.member_id] = 0;
    memberTotals[c.member_id] += Number(c.modeled_cost) || 0;
  });

  // For each member, distribute stop-loss across their claims proportionally
  Object.keys(memberTotals).forEach((memberId) => {
    const total = memberTotals[memberId];
    if (total > scenario.attachment_point) {
      const overage = total - scenario.attachment_point;
      const memberClaims = modeled.filter((c) => c.member_id === memberId);
      // Sort largest first; allocate stop-loss to highest claims until overage exhausted
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

  // Final pass: residual = whatever modeled_cost is left
  modeled.forEach((c) => {
    c.residual_amount = Number(c.modeled_cost) || 0;
  });

  // Aggregates
  const sum = (arr, key) => arr.reduce((s, x) => s + (Number(x[key]) || 0), 0);
  const sumCustom = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

  const historical_claims = sum(modeled, "allowed_amount");

  // DPC eliminated = bucket A claims, the eliminated portion
  const dpc_eliminated = sumCustom(modeled, (c) => {
    if (c.bucket !== "A") return 0;
    return (Number(c.allowed_amount) || 0) * scenario.dpc_elimination_pct;
  });

  // Repriced savings = bucket B (allowed - modeled cost before stop-loss / indemnity)
  // We computed transformations into modeled_cost; track savings = allowed - (residual + stop_loss + indemnity)
  // For bucket B specifically:
  const repriced_savings = sumCustom(modeled, (c) => {
    if (c.bucket !== "B") return 0;
    const allowed = Number(c.allowed_amount) || 0;
    const finalSpend = (Number(c.residual_amount) || 0) + (Number(c.stop_loss_amount) || 0) + (Number(c.indemnity_offset) || 0);
    return Math.max(0, allowed - finalSpend);
  });

  // ER reduction savings (bucket C eliminated portion)
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

/* ---------------------------------------------------------------------
 *  SYNTHETIC CLAIMS GENERATOR (Mode 3 — no claims data)
 *  Generates a representative claims distribution from headcount + spend.
 * ------------------------------------------------------------------- */

const SYNTHETIC_DISTRIBUTION = [
  // [category, bucket, % of total spend, avg claim size, CPT, POS]
  ["Primary Care",   "A", 0.10, 175,    "99213", "Office"],
  ["Lab",            "A", 0.04, 60,     "80053", "Independent Lab"],
  ["Specialist Consult", "B", 0.12, 320, "99214", "Office"],
  ["Imaging",        "B", 0.10, 800,    "73721", "Imaging Center"],
  ["Procedures",     "B", 0.08, 2400,   "45378", "ASC"],
  ["Urgent Care",    "B", 0.04, 220,    "99203", "Urgent Care"],
  ["ER",             "C", 0.12, 1800,   "99284", "Emergency Room"],
  ["Outpatient Surgery", "B", 0.10, 6500, "29881", "ASC"],
  ["Inpatient",      "E", 0.18, 28000,  "99223", "Inpatient Hospital"],
  ["Specialty Rx",   "D", 0.08, 4200,   "",      "Pharmacy"],
  ["Other",          "D", 0.04, 350,    "",      "Office"],
];

const MAX_SYNTHETIC_CLAIMS = 20000;

function generateSyntheticClaims(coveredLives, annualSpend) {
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
      // Distribute across members with realistic concentration (Pareto-ish)
      // Inpatient/specialty Rx concentrate on few members
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

/* ---------------------------------------------------------------------
 *  STORAGE WRAPPER
 * ------------------------------------------------------------------- */

const storage = {
  async list(prefix) {
    try { const r = await window.storage.list(prefix); return r?.keys || []; } catch { return []; }
  },
  async get(key) {
    try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; } catch { return null; }
  },
  async set(key, value) {
    try { await window.storage.set(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  async delete(key) {
    try { await window.storage.delete(key); return true; } catch { return false; }
  },
};

/* ---------------------------------------------------------------------
 *  COMPONENT — APP SHELL
 * ------------------------------------------------------------------- */

const SCREENS = {
  CASES: "cases",
  SETUP: "setup",
  UPLOAD: "upload",
  CLASSIFY: "classify",
  SCENARIO: "scenario",
  DASHBOARD: "dashboard",
  REPORT: "report",
  ADMIN: "admin",
};

function ClaimsReclassificationEngine() {
  const [screen, setScreen] = useState(SCREENS.CASES);
  const [employers, setEmployers] = useState([]);
  const [activeEmployerId, setActiveEmployerId] = useState(null);
  const [activeEmployer, setActiveEmployer] = useState(null);
  const [claims, setClaims] = useState([]);
  const [classifiedClaims, setClassifiedClaims] = useState([]);
  const [activeScenario, setActiveScenario] = useState({ ...SCENARIO_PRESETS.expected });
  const [loading, setLoading] = useState(false);
  const [cptRules, setCptRules] = useState(DEFAULT_CPT_RULES);
  const [cashPrices, setCashPrices] = useState(DEFAULT_CASH_PRICES);
  const [indemnityBenefits, setIndemnityBenefits] = useState(DEFAULT_INDEMNITY_BENEFITS);
  const [repriceFactors, setRepriceFactors] = useState(DEFAULT_REPRICE_FACTORS);
  const [toast, setToast] = useState(null);

  // ---- Versioning & audit (Data Dictionary v2) ----
  const [pricingVersions, setPricingVersions]     = useState([INITIAL_PRICING_VERSION]);
  const [ruleVersions, setRuleVersions]           = useState([INITIAL_RULE_VERSION]);
  const [indemnityVersions, setIndemnityVersions] = useState([INITIAL_INDEMNITY_VERSION]);
  const [benchmarkVersions, setBenchmarkVersions] = useState([INITIAL_BENCHMARK_VERSION]);
  const [auditLog, setAuditLog]                   = useState([]);
  const [inputModeRecord, setInputModeRecord]     = useState(null); // current employer's input_mode row

  // Active version IDs derived from versions in 'active' status
  const activePricingVersion   = pricingVersions.find((v)   => v.status === "active") || INITIAL_PRICING_VERSION;
  const activeRuleVersion      = ruleVersions.find((v)      => v.status === "active") || INITIAL_RULE_VERSION;
  const activeIndemnityVersion = indemnityVersions.find((v) => v.status === "active") || INITIAL_INDEMNITY_VERSION;
  const activeBenchmarkVersion = benchmarkVersions.find((v) => v.status === "active") || INITIAL_BENCHMARK_VERSION;

  // Load employers on mount
  useEffect(() => { loadEmployers(); loadVersionsAndAudit(); }, []);

  const loadVersionsAndAudit = async () => {
    const pv = await storage.get("global:pricing_versions"); if (pv) setPricingVersions(pv);
    const rv = await storage.get("global:rule_versions"); if (rv) setRuleVersions(rv);
    const iv = await storage.get("global:indemnity_versions"); if (iv) setIndemnityVersions(iv);
    const bv = await storage.get("global:benchmark_versions"); if (bv) setBenchmarkVersions(bv);
    const al = await storage.get("global:audit_log"); if (al) setAuditLog(al);
    const cp = await storage.get("global:cash_prices"); if (cp) setCashPrices(cp);
    const ib = await storage.get("global:indemnity_benefits"); if (ib) setIndemnityBenefits(ib);
    const rf = await storage.get("global:reprice_factors"); if (rf) setRepriceFactors(rf);
  };

  // Append an audit log row and persist
  const writeAudit = async (entry) => {
    const row = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actor_user_id: "current_user",
      actor_role: "admin",
      created_at: Date.now(),
      ...entry,
    };
    const next = [row, ...auditLog].slice(0, 500); // cap at 500 most recent
    setAuditLog(next);
    await storage.set("global:audit_log", next);
  };

  // Create a new version on top of an existing one. Archives the prior active.
  const cutNewVersion = async (kind, mutateFn, changeSummary) => {
    const tables = {
      pricing:    [pricingVersions,   setPricingVersions,   "global:pricing_versions",   "pricing_version"],
      rule:       [ruleVersions,      setRuleVersions,      "global:rule_versions",      "rule_version"],
      indemnity:  [indemnityVersions, setIndemnityVersions, "global:indemnity_versions", "indemnity_version"],
      benchmark:  [benchmarkVersions, setBenchmarkVersions, "global:benchmark_versions", "benchmark_version"],
    };
    const [list, setter, storageKey, entityType] = tables[kind];
    const prior = list.find((v) => v.status === "active");
    const archived = list.map((v) => (v.id === prior?.id ? { ...v, status: "archived" } : v));
    const newId = `${kind.slice(0, 2)}_${Date.now()}`;
    const newVersion = {
      id: newId,
      version_label: new Date().toISOString().slice(0, 10),
      effective_at: Date.now(),
      status: "active",
      change_summary: changeSummary || "Admin update",
      created_by: "current_user",
      created_at: Date.now(),
      ...(kind === "pricing"    ? { price_table: mutateFn() } : {}),
      ...(kind === "rule"       ? { rule_set: mutateFn() } : {}),
      ...(kind === "indemnity"  ? { benefit_schedule: mutateFn() } : {}),
      ...(kind === "benchmark"  ? { source_documentation: prior?.source_documentation || "" } : {}),
    };
    const next = [newVersion, ...archived];
    setter(next);
    await storage.set(storageKey, next);
    await writeAudit({
      action: "create",
      entity_type: entityType,
      entity_id: newId,
      before_state: prior || null,
      after_state: newVersion,
      change_reason: changeSummary || "Admin update",
    });
    return newVersion;
  };

  const showToast = (message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadEmployers = async () => {
    setLoading(true);
    const keys = await storage.list("employer:");
    const list = [];
    for (const k of keys) {
      const e = await storage.get(k);
      if (e) list.push(e);
    }
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    setEmployers(list);
    setLoading(false);
  };

  const loadEmployer = async (id) => {
    setLoading(true);
    const e = await storage.get(`employer:${id}`);
    const c = await storage.get(`claims:${id}`) || [];
    const s = await storage.get(`scenario:${id}`) || { ...SCENARIO_PRESETS.expected };
    const im = await storage.get(`input_mode:${id}`);
    setActiveEmployerId(id);
    setActiveEmployer(e);
    setClaims(c);
    setClassifiedClaims(c.filter((x) => x.bucket));
    setActiveScenario(s);
    setInputModeRecord(im);
    setLoading(false);
  };

  const saveEmployer = async (employer) => {
    await storage.set(`employer:${employer.id}`, employer);
    setActiveEmployer(employer);
    await loadEmployers();
  };

  const saveClaims = async (newClaims) => {
    if (!activeEmployerId) return;
    await storage.set(`claims:${activeEmployerId}`, newClaims);
    setClaims(newClaims);
    setClassifiedClaims(newClaims.filter((x) => x.bucket));
  };

  const saveScenario = async (scn) => {
    if (!activeEmployerId) return;
    await storage.set(`scenario:${activeEmployerId}`, scn);
    setActiveScenario(scn);
  };

  const deleteEmployer = async (id) => {
    await storage.delete(`employer:${id}`);
    await storage.delete(`claims:${id}`);
    await storage.delete(`scenario:${id}`);
    if (activeEmployerId === id) {
      setActiveEmployerId(null);
      setActiveEmployer(null);
      setClaims([]);
      setClassifiedClaims([]);
    }
    await loadEmployers();
  };

  // The calculation result (memoized)
  const result = useMemo(() => {
    if (!classifiedClaims.length) return null;
    return runCalculation(classifiedClaims, activeScenario, cashPrices, indemnityBenefits, repriceFactors);
  }, [classifiedClaims, activeScenario, cashPrices, indemnityBenefits, repriceFactors]);

  /* ----------------- RENDER ----------------- */

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}
         className="min-h-screen bg-stone-50 text-stone-900">
      <Header
        screen={screen}
        setScreen={setScreen}
        activeEmployer={activeEmployer}
        clearEmployer={() => { setActiveEmployerId(null); setActiveEmployer(null); setClaims([]); setClassifiedClaims([]); setScreen(SCREENS.CASES); }}
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {screen === SCREENS.CASES && (
          <CasesScreen
            employers={employers}
            loading={loading}
            onOpen={async (id) => { await loadEmployer(id); setScreen(SCREENS.UPLOAD); }}
            onCreateNew={() => setScreen(SCREENS.SETUP)}
            onDelete={deleteEmployer}
          />
        )}
        {screen === SCREENS.SETUP && (
          <SetupScreen
            initial={activeEmployer}
            onSave={async (emp) => { await saveEmployer(emp); setActiveEmployerId(emp.id); setScreen(SCREENS.UPLOAD); showToast("Employer case saved", "success"); }}
          />
        )}
        {screen === SCREENS.UPLOAD && (
          <UploadScreen
            employer={activeEmployer}
            existingClaims={claims}
            cptRules={cptRules}
            inputModeRecord={inputModeRecord}
            onClaimsLoaded={async (parsed, meta = {}) => {
              const mode = meta.mode || "full";
              const m = INPUT_MODES[mode.toUpperCase()] || INPUT_MODES.FULL;
              const confidence = meta.confidence || m.confidence;
              const dataSource = meta.data_source || (mode === "full" ? "claims_extract" : "broker_report");
              const assumptionSource = mode === "modeled" ? ASSUMPTION_SOURCES.BENCHMARK : ASSUMPTION_SOURCES.ACTUAL;

              const classified = parsed.map((c) => {
                const r = normalizeAndClassify(c, cptRules);
                return {
                  ...c,
                  normalized_category: r.category,
                  bucket: r.bucket,
                  bucket_default: r.bucket,
                  classification_confidence: r.confidence,
                  classification_source: r.source,
                  // Provenance
                  input_mode: mode,
                  data_source: dataSource,
                  confidence_level: confidence,
                  assumption_source: assumptionSource,
                  pricing_version_id: activePricingVersion.id,
                  rule_version_id: activeRuleVersion.id,
                  indemnity_version_id: activeIndemnityVersion.id,
                  benchmark_version_id: mode === "modeled" ? activeBenchmarkVersion.id : null,
                  manual_override: false,
                  override_reason: null,
                };
              });

              const inputModeRow = {
                id: `im_${Date.now()}`,
                employer_id: activeEmployerId,
                mode,
                uploaded_file_name: meta.file_name || null,
                row_count: parsed.length,
                claim_lines_total: mode === "full" ? parsed.length : null,
                categories_total: mode === "partial" ? parsed.length : null,
                benchmark_profile_id: mode === "modeled" ? activeBenchmarkVersion.id : null,
                confidence_default: m.confidence,
                confidence_override: meta.confidence_override || null,
                uploaded_by: "current_user",
                uploaded_at: Date.now(),
              };
              setInputModeRecord(inputModeRow);
              await storage.set(`input_mode:${activeEmployerId}`, inputModeRow);
              await saveClaims(classified);
              showToast(`${classified.length} claim records ingested · ${m.label}`, "success");
              setScreen(SCREENS.CLASSIFY);
            }}
            onSyntheticGenerate={async (lives, spend) => {
              const { claims: synth, meta: synthMeta } = generateSyntheticClaims(lives, spend);
              const classified = synth.map((c) => {
                const r = normalizeAndClassify(c, cptRules);
                return {
                  ...c,
                  normalized_category: r.category,
                  bucket: r.bucket,
                  bucket_default: r.bucket,
                  classification_confidence: r.confidence,
                  classification_source: r.source,
                  input_mode: "modeled",
                  data_source: "benchmark",
                  confidence_level: "low",
                  assumption_source: ASSUMPTION_SOURCES.BENCHMARK,
                  pricing_version_id: activePricingVersion.id,
                  rule_version_id: activeRuleVersion.id,
                  indemnity_version_id: activeIndemnityVersion.id,
                  benchmark_version_id: activeBenchmarkVersion.id,
                  manual_override: false,
                  override_reason: null,
                };
              });
              const inputModeRow = {
                id: `im_${Date.now()}`,
                employer_id: activeEmployerId,
                mode: "modeled",
                row_count: classified.length,
                benchmark_profile_id: activeBenchmarkVersion.id,
                confidence_default: "low",
                uploaded_by: "current_user",
                uploaded_at: Date.now(),
              };
              setInputModeRecord(inputModeRow);
              await storage.set(`input_mode:${activeEmployerId}`, inputModeRow);
              await saveClaims(classified);
              const cappedNote = synthMeta.wasCapped
                ? ` (capped from ${synthMeta.requestedClaims.toLocaleString()} to protect browser memory)`
                : "";
              showToast(`Modeled dataset built · ${classified.length.toLocaleString()} synthetic lines${cappedNote}`, "success");
              setScreen(SCREENS.CLASSIFY);
            }}
            showToast={showToast}
          />
        )}
        {screen === SCREENS.CLASSIFY && (
          <ClassifyScreen
            claims={classifiedClaims}
            onUpdateClaim={async (claim_id, updates, reason) => {
              const next = classifiedClaims.map((c) =>
                c.claim_id === claim_id
                  ? { ...c, ...updates, manual_override: true, override_reason: reason || c.override_reason || "User reclassification" }
                  : c);
              await saveClaims(next);
              await writeAudit({
                action: "update",
                entity_type: "manual_override",
                entity_id: claim_id,
                before_state: classifiedClaims.find((c) => c.claim_id === claim_id),
                after_state: next.find((c) => c.claim_id === claim_id),
                change_reason: reason || "Manual claim reclassification",
              });
            }}
          />
        )}
        {screen === SCREENS.SCENARIO && (
          <ScenarioScreen
            scenario={activeScenario}
            onChange={saveScenario}
            onPreset={async (key) => { await saveScenario({ ...SCENARIO_PRESETS[key] }); }}
          />
        )}
        {screen === SCREENS.DASHBOARD && (
          <DashboardScreen
            employer={activeEmployer}
            scenario={activeScenario}
            result={result}
            classifiedClaims={classifiedClaims}
            inputModeRecord={inputModeRecord}
            activePricingVersion={activePricingVersion}
            activeRuleVersion={activeRuleVersion}
            activeIndemnityVersion={activeIndemnityVersion}
            activeBenchmarkVersion={activeBenchmarkVersion}
            onScenarioChange={saveScenario}
          />
        )}
        {screen === SCREENS.REPORT && (
          <ReportScreen
            employer={activeEmployer}
            scenario={activeScenario}
            result={result}
            classifiedClaims={classifiedClaims}
            inputModeRecord={inputModeRecord}
            activePricingVersion={activePricingVersion}
            activeRuleVersion={activeRuleVersion}
            activeIndemnityVersion={activeIndemnityVersion}
            activeBenchmarkVersion={activeBenchmarkVersion}
          />
        )}
        {screen === SCREENS.ADMIN && (
          <AdminScreen
            cptRules={cptRules}
            cashPrices={cashPrices}
            indemnityBenefits={indemnityBenefits}
            repriceFactors={repriceFactors}
            pricingVersions={pricingVersions}
            ruleVersions={ruleVersions}
            indemnityVersions={indemnityVersions}
            benchmarkVersions={benchmarkVersions}
            auditLog={auditLog}
            onUpdateCashPrices={async (next, reason) => {
              setCashPrices(next);
              await storage.set("global:cash_prices", next);
              await cutNewVersion("pricing", () => next, reason || "Cash-pay table updated");
              showToast("New pricing version created", "success");
            }}
            onUpdateIndemnity={async (next, reason) => {
              setIndemnityBenefits(next);
              await storage.set("global:indemnity_benefits", next);
              await cutNewVersion("indemnity", () => next, reason || "Indemnity schedule updated");
              showToast("New indemnity version created", "success");
            }}
            onUpdateRepriceFactors={async (next, reason) => {
              setRepriceFactors(next);
              await storage.set("global:reprice_factors", next);
              await cutNewVersion("rule", () => ({ cpt_rules: cptRules, reprice_factors: next }), reason || "Repricing factors updated");
              showToast("New rule version created", "success");
            }}
          />
        )}
      </main>

      {toast && <Toast {...toast} />}
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  HEADER
 * ------------------------------------------------------------------- */

function Header({ screen, setScreen, activeEmployer, clearEmployer }) {
  const navItems = activeEmployer ? [
    { id: SCREENS.UPLOAD,     label: "Data",        icon: Upload },
    { id: SCREENS.CLASSIFY,   label: "Classify",    icon: Database },
    { id: SCREENS.SCENARIO,   label: "Scenario",    icon: Sliders },
    { id: SCREENS.DASHBOARD,  label: "Dashboard",   icon: BarChart3 },
    { id: SCREENS.REPORT,     label: "Report",      icon: FileDown },
  ] : [];

  return (
    <header className="border-b border-stone-200 bg-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={clearEmployer} className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-stone-900 text-stone-50 rounded grid place-items-center">
              <Layers size={16} strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="font-display text-xl">OffPlan</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-medium">
                Reclassification Engine
              </div>
            </div>
          </button>
          {activeEmployer && (
            <>
              <div className="h-8 w-px bg-stone-200 mx-2" />
              <div className="text-sm">
                <div className="text-stone-500 text-[10px] uppercase tracking-wider">Active case</div>
                <div className="font-medium text-stone-900">{activeEmployer.name}</div>
              </div>
            </>
          )}
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`flex items-center gap-2 px-3 h-9 text-sm rounded transition ${
                screen === item.id
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setScreen(SCREENS.ADMIN)}
            className={`ml-2 flex items-center gap-2 px-3 h-9 text-sm rounded transition ${
              screen === SCREENS.ADMIN ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            <Settings size={14} />
            Admin
          </button>
        </nav>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------
 *  CASES SCREEN
 * ------------------------------------------------------------------- */

function CasesScreen({ employers, loading, onOpen, onCreateNew, onDelete }) {
  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">
            Employer Cases
          </h1>
          <p className="text-stone-600 max-w-xl">
            Each case represents one employer's claims being reconstructed under the OffPlan model.
            Upload claims, adjust assumptions, and produce the deterministic classification output (residual fund, OffPlan stack PEPM, savings vs current spend). The headline capital output specified by the engine — Minimum Required Liquidity from the stochastic layer — is under development and not yet computed in this prototype.
          </p>
        </div>
        <button
          onClick={onCreateNew}
          className="flex items-center gap-2 bg-stone-900 text-white px-5 h-11 rounded font-medium hover:bg-stone-800 transition"
        >
          <Plus size={16} strokeWidth={2.5} />
          New Case
        </button>
      </div>

      {loading ? (
        <div className="text-stone-500">Loading...</div>
      ) : employers.length === 0 ? (
        <EmptyState
          title="No cases yet"
          description="Start by creating an employer case. You can upload a full claims file, enter summarized data, or model from headcount and current spend."
          ctaLabel="Create your first case"
          onAction={onCreateNew}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {employers.map((e) => (
            <EmployerCard key={e.id} employer={e} onOpen={() => onOpen(e.id)} onDelete={() => onDelete(e.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployerCard({ employer, onOpen, onDelete }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5 hover:border-stone-400 transition group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-stone-900 truncate">{employer.name}</h3>
          <div className="text-xs text-stone-500 mt-0.5">
            {employer.industry || "—"} · {employer.state || "—"}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm("Delete this case?")) onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-600 transition"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Stat label="Covered Lives" value={fmtNum(employer.covered_lives)} />
        <Stat label="Total Spend" value={Number(employer.current_total_healthcare_spend) > 0 ? fmtUSD(employer.current_total_healthcare_spend) : "—"} />
      </div>
      <button
        onClick={onOpen}
        className="w-full text-sm text-stone-700 hover:text-stone-900 flex items-center justify-between border-t border-stone-100 pt-3"
      >
        <span>Open case</span>
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-0.5">{label}</div>
      <div className="font-mono text-sm text-stone-900 num">{value}</div>
    </div>
  );
}

function EmptyState({ title, description, ctaLabel, onAction }) {
  return (
    <div className="border border-dashed border-stone-300 rounded-lg p-16 text-center bg-white/50">
      <h3 className="font-display text-2xl text-stone-900 mb-2">{title}</h3>
      <p className="text-stone-600 max-w-md mx-auto mb-6">{description}</p>
      <button onClick={onAction} className="bg-stone-900 text-white px-5 h-11 rounded font-medium hover:bg-stone-800">
        {ctaLabel}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  SETUP SCREEN
 * ------------------------------------------------------------------- */

function SetupScreen({ initial, onSave }) {
  const [form, setForm] = useState(initial || {
    id: `EMP_${Date.now()}`,
    name: "",
    industry: "",
    state: "",
    employee_count: "",
    covered_lives: "",

    // ---- Baseline (per spec addendum) ----
    current_funding_model: "",                 // fully_insured | level_funded | self_funded | unsure
    historical_claims_spend: "",               // used for reclassification modeling
    current_total_healthcare_spend: "",        // used for savings comparison (REQUIRED)
    baseline_spend_type: "",                   // total_premium | total_plan_cost | level_funded_contribution
    includes_stop_loss: false,
    includes_admin_fees: false,
    includes_broker_fees: false,
    baseline_confidence: "medium",             // high | medium | low

    // ---- Legacy back-compat field removed in v3.3 ----
    // current_annual_spend is no longer maintained. The single source of truth for
    // the savings baseline is current_total_healthcare_spend. Historical cases that
    // had only current_annual_spend will display "—" for Total Spend until the
    // operator enters a valid current_total_healthcare_spend.
    current_pepm: "",
    claims_period_start: "2025-01-01",
    claims_period_end: "2025-12-31",
    plan_type: "Fully Insured",
    created_at: Date.now(),
  });

  const set = (k, v) => setForm({ ...form, [k]: v });

  // Auto-set baseline_spend_type and plan_type from funding model
  useEffect(() => {
    if (!form.current_funding_model) return;
    const map = {
      fully_insured:    { plan: "Fully Insured", btype: "total_premium" },
      level_funded:     { plan: "Level Funded",  btype: "level_funded_contribution" },
      self_funded:      { plan: "Self Funded",   btype: "total_plan_cost" },
      unsure:           { plan: form.plan_type,  btype: "" },
    }[form.current_funding_model];
    if (map) setForm((f) => ({ ...f, plan_type: map.plan, baseline_spend_type: map.btype }));
    // eslint-disable-next-line
  }, [form.current_funding_model]);

  const computedPEPM = useMemo(() => {
    const spend = Number(form.current_total_healthcare_spend) || 0;
    const lives = Number(form.covered_lives) || 0;
    if (!spend || !lives) return 0;
    return spend / lives / 12;
  }, [form.current_total_healthcare_spend, form.covered_lives]);

  const isValid =
    form.name &&
    form.covered_lives &&
    form.current_funding_model &&
    form.current_total_healthcare_spend &&
    form.historical_claims_spend;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Employer Setup</h1>
      <p className="text-stone-600 mb-8">
        Establish baseline facts. These anchor the entire reclassification analysis.
      </p>

      <div className="bg-white border border-stone-200 rounded-lg p-8 space-y-6">
        <Field label="Employer Name" required>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ABC Manufacturing"
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Industry">
            <select
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
            >
              <option value="">Select industry</option>
              {["Manufacturing", "Construction", "Professional Services", "Hospitality", "Retail",
                "Healthcare", "Technology", "Finance", "Logistics", "Other"].map(x =>
                <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="State">
            <input
              value={form.state}
              onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))}
              placeholder="GA"
              maxLength={2}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900 uppercase"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Employees" required>
            <input
              type="number" value={form.employee_count}
              onChange={(e) => set("employee_count", e.target.value)}
              placeholder="75"
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
            />
          </Field>
          <Field label="Covered Lives" required tooltip="Includes employees and dependents">
            <input
              type="number" value={form.covered_lives}
              onChange={(e) => set("covered_lives", e.target.value)}
              placeholder="162"
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
            />
          </Field>
        </div>

        {/* ---- BASELINE WIZARD (Spec Addendum) ---- */}
        <div className="border-t border-stone-200 pt-6 mt-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Baseline · Two Questions
          </div>
          <h3 className="font-display text-2xl text-stone-900 mb-1">How healthcare is paid for today</h3>
          <p className="text-xs text-stone-500 mb-5 max-w-xl leading-relaxed">
            Savings are calculated against current total healthcare spend, not claims-only spend.
            For fully insured employers, use total annual premium. For self-funded employers,
            include claims paid, TPA fees, network access fees, stop-loss premium, PBM/admin fees,
            and other plan costs.
          </p>

          {/* Q1 — Funding model */}
          <Field label="Question 1 · Current Funding Model" required>
            <div className="grid grid-cols-4 gap-2">
              {[
                { v: "fully_insured",  l: "Fully Insured",  s: "Carrier-billed premium" },
                { v: "level_funded",   l: "Level Funded",   s: "Premium + claims fund" },
                { v: "self_funded",    l: "Self Funded",    s: "Pays claims + admin" },
                { v: "unsure",         l: "Unsure",         s: "Confirm with broker" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => set("current_funding_model", opt.v)}
                  className={`text-left rounded border p-3 transition ${
                    form.current_funding_model === opt.v
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 bg-stone-50 hover:border-stone-400"
                  }`}
                >
                  <div className="font-medium text-sm">{opt.l}</div>
                  <div className={`text-[11px] mt-0.5 ${form.current_funding_model === opt.v ? "text-stone-300" : "text-stone-500"}`}>{opt.s}</div>
                </button>
              ))}
            </div>
          </Field>

          {/* Q2 — Baseline spend (label varies with funding model) */}
          <div className="mt-5">
            <Field
              label={
                form.current_funding_model === "fully_insured"
                  ? "Question 2 · Total Annual Premium"
                  : form.current_funding_model === "self_funded"
                  ? "Question 2 · Total Annual Plan Cost"
                  : form.current_funding_model === "level_funded"
                  ? "Question 2 · Total Annual Level-Funded Contribution"
                  : "Question 2 · Current Total Healthcare Spend"
              }
              required
              tooltip={
                form.current_funding_model === "fully_insured"
                  ? "Sum of all premium paid to carrier for medical/Rx"
                  : form.current_funding_model === "self_funded"
                  ? "Claims paid + stop-loss + TPA + network + PBM/admin + broker"
                  : form.current_funding_model === "level_funded"
                  ? "Includes expected claims fund, stop-loss, admin, carrier/TPA fees"
                  : "Total annual healthcare spend, all-in"
              }
            >
              <input
                type="number"
                value={form.current_total_healthcare_spend}
                onChange={(e) => set("current_total_healthcare_spend", e.target.value)}
                placeholder="1187450"
                className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
              />
            </Field>
          </div>

          {/* Inclusions checklist for self-funded / level-funded */}
          {(form.current_funding_model === "self_funded" || form.current_funding_model === "level_funded") && (
            <div className="mt-4 bg-stone-50 border border-stone-200 rounded p-4">
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-2">
                Confirm what is included in the figure above
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {[
                  ["includes_stop_loss",  "Stop-loss premium"],
                  ["includes_admin_fees", "TPA / PBM / admin fees"],
                  ["includes_broker_fees", "Broker / consultant fees"],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form[k]}
                      onChange={(e) => set(k, e.target.checked)}
                      className="rounded border-stone-300"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 items-center">
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Baseline confidence</label>
                <select
                  value={form.baseline_confidence}
                  onChange={(e) => set("baseline_confidence", e.target.value)}
                  className="bg-white border border-stone-200 rounded px-2 h-9 text-sm"
                >
                  <option value="high">High · Confirmed by broker/CFO</option>
                  <option value="medium">Medium · Reasonable estimate</option>
                  <option value="low">Low · Rough placeholder</option>
                </select>
              </div>
            </div>
          )}

          {/* Historical Claims Spend (separate from baseline) */}
          <div className="mt-5 grid grid-cols-2 gap-4">
            <Field
              label="Historical Claims Spend (12 mo)"
              required
              tooltip="Medical + Rx + facility + professional. Used for reclassification modeling, not for savings."
            >
              <input
                type="number"
                value={form.historical_claims_spend}
                onChange={(e) => set("historical_claims_spend", e.target.value)}
                placeholder="950000"
                className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
              />
            </Field>
            <Field label="Current PEPM (from baseline)">
              <div className="w-full bg-stone-100 border border-stone-200 rounded px-3 h-11 flex items-center text-stone-600 font-mono num">
                {fmtUSD(computedPEPM, 2)}
              </div>
            </Field>
          </div>

          {/* Helper warning if claims > baseline */}
          {Number(form.historical_claims_spend) > 0 &&
           Number(form.current_total_healthcare_spend) > 0 &&
           Number(form.historical_claims_spend) > Number(form.current_total_healthcare_spend) && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 flex gap-2">
              <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                Historical claims exceed current total spend. Double-check that Question 2 reflects total healthcare cost (premium or full plan cost), not just claims.
              </div>
            </div>
          )}
        </div>

        {/* ---- Period ---- */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Claims Period Start">
            <input
              type="date" value={form.claims_period_start}
              onChange={(e) => set("claims_period_start", e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
            />
          </Field>
          <Field label="Claims Period End">
            <input
              type="date" value={form.claims_period_end}
              onChange={(e) => set("claims_period_end", e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
            />
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <button
            disabled={!isValid}
            onClick={() => onSave({
              ...form,
              current_pepm: computedPEPM,
            })}
            className="bg-stone-900 text-white px-6 h-11 rounded font-medium hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Save and Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required, tooltip }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-stone-600 font-medium mb-1.5 flex items-center gap-1">
        {label}
        {required && <span className="text-red-600">*</span>}
        {tooltip && <span className="text-stone-400 normal-case font-normal tracking-normal">· {tooltip}</span>}
      </label>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  UPLOAD SCREEN — Three modes (Full / Summary / Modeled)
 * ------------------------------------------------------------------- */

function UploadScreen({ employer, existingClaims, onClaimsLoaded, onSyntheticGenerate, showToast, inputModeRecord }) {
  const [mode, setMode] = useState(existingClaims.length ? "current" : "");
  const [parseErrors, setParseErrors] = useState([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  const REQUIRED_FIELDS = ["claim_id", "member_id", "service_date", "allowed_amount", "place_of_service"];
  const PARTIAL_REQUIRED = ["claims_category", "annual_spend", "covered_lives", "data_source", "confidence_level"];

  const handleFullClaimsFile = (file) => {
    setParsing(true);
    setParseErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (results) => {
        const rows = results.data;
        const errors = [];

        if (rows.length === 0) errors.push("File is empty.");
        else {
          const missingHeaders = REQUIRED_FIELDS.filter((f) => !(f in rows[0]));
          if (missingHeaders.length) errors.push(`Missing required columns: ${missingHeaders.join(", ")}`);
        }

        const validRows = [];
        rows.forEach((row, i) => {
          const rowNum = i + 2;
          if (!row.claim_id) { errors.push(`Row ${rowNum}: missing claim_id`); return; }
          if (!row.member_id) { errors.push(`Row ${rowNum}: missing member_id`); return; }
          const allowed = parseFloat(row.allowed_amount);
          if (isNaN(allowed) || allowed < 0) { errors.push(`Row ${rowNum}: invalid allowed_amount`); return; }
          row.allowed_amount = allowed;
          row.paid_amount = parseFloat(row.paid_amount) || 0;
          validRows.push(row);
        });

        if (errors.length > 5) setParseErrors([...errors.slice(0, 5), `... and ${errors.length - 5} more issues.`]);
        else setParseErrors(errors);

        if (validRows.length > 0 && errors.length < rows.length) {
          onClaimsLoaded(validRows, { mode: "full", file_name: file.name, data_source: "claims_extract" });
        }
        setParsing(false);
      },
      error: (err) => { setParseErrors([`Parse error: ${err.message}`]); setParsing(false); },
    });
  };

  const handlePartialSummaryFile = (file) => {
    setParsing(true);
    setParseErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (results) => {
        const rows = results.data;
        const errors = [];

        if (rows.length === 0) errors.push("File is empty.");
        else {
          const missingHeaders = PARTIAL_REQUIRED.filter((f) => !(f in rows[0]));
          if (missingHeaders.length) errors.push(`Missing required columns: ${missingHeaders.join(", ")}`);
        }

        const synthClaims = [];
        let seq = 1;
        const lives = Number(employer?.covered_lives) || 100;
        const fileMaxConfidence = { high: 3, medium: 2, low: 1 };
        let minConf = 3;
        let aggDataSource = null;

        rows.forEach((row, i) => {
          const rowNum = i + 2;
          const cat = (row.claims_category || "").trim();
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
              member_id: `M${String((seq % Math.max(2, lives)) + 1).padStart(4, "0")}`,
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

        if (errors.length > 5) setParseErrors([...errors.slice(0, 5), `... and ${errors.length - 5} more issues.`]);
        else setParseErrors(errors);

        if (synthClaims.length > 0) {
          const confidence = minConf === 3 ? "high" : minConf === 2 ? "medium" : "low";
          onClaimsLoaded(synthClaims, {
            mode: "partial",
            file_name: file.name,
            data_source: aggDataSource || "broker_report",
            confidence,
          });
        }
        setParsing(false);
      },
      error: (err) => { setParseErrors([`Parse error: ${err.message}`]); setParsing(false); },
    });
  };

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Claims Data</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Three input modes. The engine adapts to the data you have. Every record carries its provenance through the rest of the analysis.
      </p>

      {existingClaims.length > 0 && mode === "current" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 mb-6 flex items-center justify-between">
          <div>
            <div className="font-medium text-emerald-900 flex items-center gap-2">
              {existingClaims.length.toLocaleString()} records loaded for {employer?.name}
              {inputModeRecord && (
                <span className="bg-white border border-emerald-300 text-emerald-800 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded">
                  {INPUT_MODES[inputModeRecord.mode?.toUpperCase()]?.label || inputModeRecord.mode}
                </span>
              )}
            </div>
            <div className="text-sm text-emerald-700 mt-0.5">
              Total allowed: {fmtUSD(existingClaims.reduce((s, c) => s + (Number(c.allowed_amount) || 0), 0))}
            </div>
          </div>
          <button onClick={() => setMode("")} className="text-sm text-emerald-700 hover:text-emerald-900 underline">
            Replace data
          </button>
        </div>
      )}

      {(mode !== "current" || existingClaims.length === 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <ModeCard
            active={mode === "full"}
            onClick={() => setMode("full")}
            badge="Mode 1"
            title="Full Claims"
            description="CPT-level detail. Self-funded employers, broker reports, TPA exports."
            confidence="High confidence"
            confColor="emerald"
          />
          <ModeCard
            active={mode === "summary"}
            onClick={() => setMode("summary")}
            badge="Mode 2"
            title="Partial Summary"
            description="Category-level totals from broker, carrier, or PBM reports."
            confidence="Medium confidence"
            confColor="amber"
          />
          <ModeCard
            active={mode === "modeled"}
            onClick={() => setMode("modeled")}
            badge="Mode 3"
            title="Modeled Profile"
            description="No claims data. Synthesized from benchmark profile."
            confidence="Low confidence · Illustrative"
            confColor="rose"
          />
        </div>
      )}

      {mode === "full" && (
        <FullClaimsUpload fileRef={fileRef} onFile={handleFullClaimsFile} parsing={parsing} errors={parseErrors} />
      )}

      {mode === "summary" && (
        <PartialSummaryUpload
          employer={employer}
          onFile={handlePartialSummaryFile}
          onManualSubmit={(claims, meta) => onClaimsLoaded(claims, { mode: "partial", ...meta })}
          parsing={parsing}
          errors={parseErrors}
          showToast={showToast}
        />
      )}

      {mode === "modeled" && (
        <ModeledInput employer={employer} onGenerate={onSyntheticGenerate} />
      )}
    </div>
  );
}

function ModeCard({ active, onClick, badge, title, description, confidence, confColor = "emerald" }) {
  const palette = {
    emerald: active ? "text-emerald-300" : "text-emerald-700",
    amber:   active ? "text-amber-300"   : "text-amber-700",
    rose:    active ? "text-rose-300"    : "text-rose-700",
  };
  return (
    <button
      onClick={onClick}
      className={`text-left p-5 rounded-lg border transition ${
        active ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-200 hover:border-stone-400"
      }`}
    >
      <div className={`text-[10px] uppercase tracking-wider mb-3 ${active ? "text-stone-400" : "text-stone-500"}`}>
        {badge}
      </div>
      <h3 className="font-display text-2xl mb-2">{title}</h3>
      <p className={`text-sm mb-4 ${active ? "text-stone-300" : "text-stone-600"}`}>{description}</p>
      <div className={`text-xs font-medium ${palette[confColor] || palette.emerald}`}>
        {confidence}
      </div>
    </button>
  );
}

function FullClaimsUpload({ fileRef, onFile, parsing, errors }) {
  const downloadTemplate = () => {
    const headers = "claim_id,employer_id,member_id,employee_id,member_relationship,member_age,member_gender,service_date,paid_date,claim_type,place_of_service,provider_specialty,facility_type,cpt_code,hcpcs_code,icd10_primary,icd10_secondary,revenue_code,drg_code,allowed_amount,paid_amount,member_oop_amount,units,provider_npi,provider_zip3,state,notes";
    const example = "CLM000001,EMP_TEST_001,M0001,E001,employee,47,F,2025-04-15,2025-05-12,Professional,Office,Family Medicine,Clinic,99213,,I10,E119,,,185,155,30,1,1234567890,331,FL,Primary Care";
    const blob = new Blob([headers + "\n" + example + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "offplan_claims_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-8">
      <div className="border-2 border-dashed border-stone-200 rounded-lg p-12 text-center"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
        <div className="w-12 h-12 bg-stone-100 rounded-full grid place-items-center mx-auto mb-4">
          <Upload size={20} className="text-stone-700" />
        </div>
        <h3 className="font-display text-2xl mb-1">Upload Claims CSV</h3>
        <p className="text-sm text-stone-600 mb-6">Drag a file here, or click to browse.</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={parsing}
            className="bg-stone-900 text-white px-5 h-10 rounded font-medium hover:bg-stone-800 disabled:opacity-50"
          >
            {parsing ? "Parsing..." : "Choose File"}
          </button>
          <button
            onClick={downloadTemplate}
            className="border border-stone-300 px-5 h-10 rounded font-medium hover:bg-stone-50 flex items-center gap-2"
          >
            <Download size={14} /> Template
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
        />
        <p className="text-xs text-stone-500 mt-6">
          Required: claim_id · member_id · service_date · allowed_amount · place_of_service
        </p>
      </div>

      {errors.length > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded p-4">
          <div className="flex gap-2">
            <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-amber-900 mb-1">Validation issues</div>
              {errors.map((e, i) => <div key={i} className="text-sm text-amber-800">{e}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PartialSummaryUpload({ employer, onFile, onManualSubmit, parsing, errors, showToast }) {
  const [subMode, setSubMode] = useState("csv");
  const fileRef = useRef();

  const downloadTemplate = () => {
    const headers = "employer_id,claims_category,annual_spend,claim_count,covered_lives,data_source,confidence_level,period_start,period_end,notes";
    const examples = [
      `${employer?.id || "EMP_001"},Primary Care,82000,612,${employer?.covered_lives || 162},broker_report,medium,2025-01-01,2025-12-31,From broker renewal packet`,
      `${employer?.id || "EMP_001"},Specialty Care,148000,287,${employer?.covered_lives || 162},broker_report,medium,2025-01-01,2025-12-31,`,
      `${employer?.id || "EMP_001"},Imaging,94000,72,${employer?.covered_lives || 162},broker_report,high,2025-01-01,2025-12-31,Confirmed against carrier`,
      `${employer?.id || "EMP_001"},ER,68000,41,${employer?.covered_lives || 162},broker_report,medium,2025-01-01,2025-12-31,`,
      `${employer?.id || "EMP_001"},Inpatient,295000,12,${employer?.covered_lives || 162},carrier_summary,high,2025-01-01,2025-12-31,Two large admits`,
    ].join("\n");
    const blob = new Blob([headers + "\n" + examples + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "offplan_partial_summary_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex border border-stone-200 rounded overflow-hidden mb-6 inline-flex">
        {[
          { id: "csv", label: "Upload CSV" },
          { id: "manual", label: "Enter Manually" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setSubMode(t.id)}
            className={`px-4 h-10 text-sm font-medium ${
              subMode === t.id ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subMode === "csv" && (
        <div className="bg-white border border-stone-200 rounded-lg p-8">
          <div className="border-2 border-dashed border-stone-200 rounded-lg p-12 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
            <div className="w-12 h-12 bg-stone-100 rounded-full grid place-items-center mx-auto mb-4">
              <Upload size={20} className="text-stone-700" />
            </div>
            <h3 className="font-display text-2xl mb-1">Upload Partial Summary CSV</h3>
            <p className="text-sm text-stone-600 mb-6">One row per category. Drag a file here, or click to browse.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => fileRef.current?.click()} disabled={parsing}
                className="bg-stone-900 text-white px-5 h-10 rounded font-medium hover:bg-stone-800 disabled:opacity-50">
                {parsing ? "Parsing..." : "Choose File"}
              </button>
              <button onClick={downloadTemplate}
                className="border border-stone-300 px-5 h-10 rounded font-medium hover:bg-stone-50 flex items-center gap-2">
                <Download size={14} /> Template
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
            <p className="text-xs text-stone-500 mt-6">
              Required: claims_category · annual_spend · covered_lives · data_source · confidence_level
            </p>
          </div>

          {errors.length > 0 && (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded p-4">
              <div className="flex gap-2">
                <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-amber-900 mb-1">Validation issues</div>
                  {errors.map((e, i) => <div key={i} className="text-sm text-amber-800">{e}</div>)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subMode === "manual" && (
        <SummaryClaimsInput
          employer={employer}
          onSubmit={(claims, meta) => onManualSubmit(claims, meta)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function SummaryClaimsInput({ employer, onSubmit, showToast }) {
  const [totals, setTotals] = useState({
    "Primary Care": "",
    "Specialty Care": "",
    "Imaging": "",
    "Lab": "",
    "Procedures": "",
    "ER": "",
    "Urgent Care": "",
    "Outpatient Surgery": "",
    "Inpatient": "",
    "Pharmacy": "",
    "Other": "",
  });
  const [dataSource, setDataSource] = useState("broker_report");
  const [confidence, setConfidence] = useState("medium");

  const total = Object.values(totals).reduce((s, v) => s + (Number(v) || 0), 0);

  const submit = () => {
    if (!total) { showToast("Enter at least one category total", "error"); return; }
    const claims = [];
    let seq = 1;
    const lives = Number(employer?.covered_lives) || 100;
    Object.entries(totals).forEach(([category, value]) => {
      const v = Number(value) || 0;
      if (v <= 0) return;
      const rep = SYNTHETIC_DISTRIBUTION.find(([cat]) => cat.toLowerCase() === category.toLowerCase());
      if (!rep) return;
      const [, , , avgSize, cpt, pos] = rep;
      const count = Math.max(1, Math.round(v / avgSize));
      const claimSize = v / count;
      for (let i = 0; i < count; i++) {
        const memberId = `M${String((seq % Math.max(2, lives)) + 1).padStart(4, "0")}`;
        claims.push({
          claim_id: `CLM_PART_${String(seq).padStart(6, "0")}`,
          member_id: memberId,
          service_date: "2025-06-15",
          cpt_code: cpt,
          place_of_service: pos,
          provider_specialty: category === "Primary Care" ? "Family Medicine" : "",
          claim_type: category === "Pharmacy" ? "Rx" : category === "Inpatient" ? "Facility" : "Professional",
          allowed_amount: claimSize,
          drg_code: category === "Inpatient" ? "291" : "",
          _from_summary: true,
          _summary_category: category,
        });
        seq++;
      }
    });
    onSubmit(claims, { data_source: dataSource, confidence });
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-8">
      <h3 className="font-display text-2xl mb-2">Category Totals</h3>
      <p className="text-stone-600 text-sm mb-6">
        Enter total allowed spend by category. The engine decomposes each total into representative claim lines using national benchmarks.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Field label="Data Source">
          <select value={dataSource} onChange={(e) => setDataSource(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900">
            <option value="broker_report">Broker report</option>
            <option value="carrier_summary">Carrier summary</option>
            <option value="pbm_report">PBM report</option>
            <option value="self_reported">Self-reported by employer</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Confidence Level">
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900">
            <option value="high">High · Confirmed against source</option>
            <option value="medium">Medium · Best estimate</option>
            <option value="low">Low · Rough placeholder</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {Object.keys(totals).map((cat) => (
          <Field key={cat} label={cat}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                value={totals[cat]}
                onChange={(e) => setTotals({ ...totals, [cat]: e.target.value })}
                placeholder="0"
                className="w-full bg-stone-50 border border-stone-200 rounded pl-6 pr-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
              />
            </div>
          </Field>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-stone-200 pt-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500">Total</div>
          <div className="font-mono text-2xl num">{fmtUSD(total)}</div>
        </div>
        <button
          onClick={submit}
          disabled={!total}
          className="bg-stone-900 text-white px-6 h-11 rounded font-medium hover:bg-stone-800 disabled:opacity-30"
        >
          Build Claim Lines
        </button>
      </div>
    </div>
  );
}

function ModeledInput({ employer, onGenerate }) {
  const [lives, setLives] = useState(employer?.covered_lives || "");
  const [spend, setSpend] = useState(
    employer?.historical_claims_spend ||
    employer?.current_total_healthcare_spend ||
    ""
  );

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-8">
      <h3 className="font-display text-2xl mb-2">Model from Profile</h3>
      <p className="text-stone-600 text-sm mb-6">
        For prospects without claims data. Generates a representative claims distribution based on national benchmarks scaled to the employer's covered lives and current spend.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Field label="Covered Lives">
          <input
            type="number"
            value={lives}
            onChange={(e) => setLives(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 font-mono num focus:outline-none focus:border-stone-900"
          />
        </Field>
        <Field label="Historical Claims Spend" tooltip="Medical + Rx claims for the period. Not premium.">
          <input
            type="number"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 font-mono num focus:outline-none focus:border-stone-900"
          />
        </Field>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-6 text-sm flex gap-2">
        <AlertCircle size={14} className="text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-amber-900">Modeled output. </span>
          <span className="text-amber-800">
            For directional employer conversations. Replace with actual claims data before underwriting.
          </span>
        </div>
      </div>

      <button
        onClick={() => onGenerate(Number(lives), Number(spend))}
        disabled={!lives || !spend}
        className="bg-stone-900 text-white px-6 h-11 rounded font-medium hover:bg-stone-800 disabled:opacity-30"
      >
        Generate Modeled Dataset
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  CLASSIFY SCREEN
 * ------------------------------------------------------------------- */

function ClassifyScreen({ claims, onUpdateClaim }) {
  const [filter, setFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("all");

  const grouped = useMemo(() => {
    const groups = {};
    claims.forEach((c) => {
      const key = c.normalized_category || "Other";
      if (!groups[key]) groups[key] = { category: key, bucket: c.bucket, count: 0, allowed: 0, lowConfidence: 0 };
      groups[key].count++;
      groups[key].allowed += Number(c.allowed_amount) || 0;
      if (c.classification_confidence === "low") groups[key].lowConfidence++;
    });
    return Object.values(groups).sort((a, b) => b.allowed - a.allowed);
  }, [claims]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return claims.filter((c) => {
      if (bucketFilter !== "all" && c.bucket !== bucketFilter) return false;
      if (!needle) return true;
      const searchable = [
        c.claim_id,
        c.member_id,
        c.cpt_code,
        c.place_of_service,
        c.provider_specialty,
        c.normalized_category,
        c.bucket,
        c.claim_type,
        c.allowed_amount,
      ].join(" ").toLowerCase();
      if (!searchable.includes(needle)) return false;
      return true;
    });
  }, [claims, filter, bucketFilter]);

  const lowConfidenceCount = claims.filter((c) => c.classification_confidence === "low").length;

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Classification</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Each claim has been mapped to an OffPlan bucket. Review the breakdown, override low-confidence classifications, and continue to scenario controls.
      </p>

      {/* Category breakdown */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden mb-6">
        <div className="bg-stone-50 border-b border-stone-200 px-5 py-3 flex items-center justify-between">
          <h3 className="font-medium text-stone-900">Category Breakdown</h3>
          {lowConfidenceCount > 0 && (
            <div className="text-xs text-amber-700 flex items-center gap-1">
              <AlertCircle size={12} />
              {lowConfidenceCount} claims flagged for manual review
            </div>
          )}
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">Category</th>
              <th className="text-left px-5 py-3">Bucket</th>
              <th className="text-right px-5 py-3">Claims</th>
              <th className="text-right px-5 py-3">Allowed</th>
              <th className="text-right px-5 py-3">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => {
              const totalAllowed = grouped.reduce((s, x) => s + x.allowed, 0);
              return (
                <tr key={g.category} className="border-b border-stone-100">
                  <td className="px-5 py-3">
                    <div className="font-medium text-stone-900">{g.category}</div>
                    {g.lowConfidence > 0 && (
                      <div className="text-xs text-amber-700">{g.lowConfidence} flagged</div>
                    )}
                  </td>
                  <td className="px-5 py-3"><BucketBadge bucket={g.bucket} /></td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtNum(g.count)}</td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtUSD(g.allowed)}</td>
                  <td className="px-5 py-3 text-right font-mono num text-stone-500">{fmtPct(g.allowed / totalAllowed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search claims by CPT, member, category..."
          className="flex-1 bg-white border border-stone-200 rounded px-3 h-9 text-sm focus:outline-none focus:border-stone-900"
        />
        <div className="flex border border-stone-200 rounded overflow-hidden">
          {["all", "A", "B", "C", "D", "E"].map((b) => (
            <button
              key={b}
              onClick={() => setBucketFilter(b)}
              className={`px-3 h-9 text-xs font-medium ${
                bucketFilter === b ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {b === "all" ? "All" : `Bucket ${b}`}
            </button>
          ))}
        </div>
      </div>

      {/* Detail table */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500 bg-stone-50">
                <th className="text-left px-4 py-2">Claim</th>
                <th className="text-left px-4 py-2">Member</th>
                <th className="text-left px-4 py-2">CPT</th>
                <th className="text-left px-4 py-2">POS</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">Bucket</th>
                <th className="text-right px-4 py-2">Allowed</th>
                <th className="text-left px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((c) => (
                <ClaimRow key={c.claim_id} claim={c} onUpdate={onUpdateClaim} />
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div className="px-5 py-3 text-xs text-stone-500 border-t border-stone-200 bg-stone-50">
            Showing 100 of {fmtNum(filtered.length)} claims. Use search and filters to narrow.
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimRow({ claim, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const flagged = claim.classification_confidence === "low";
  return (
    <tr className={`border-b border-stone-100 ${flagged ? "bg-amber-50/40" : ""} hover:bg-stone-50`}>
      <td className="px-4 py-2 font-mono text-xs">{claim.claim_id}</td>
      <td className="px-4 py-2 font-mono text-xs">{claim.member_id}</td>
      <td className="px-4 py-2 font-mono text-xs">{claim.cpt_code || "—"}</td>
      <td className="px-4 py-2 text-xs">{claim.place_of_service || "—"}</td>
      <td className="px-4 py-2">{claim.normalized_category}</td>
      <td className="px-4 py-2">
        {editing ? (
          <select
            value={claim.bucket}
            onChange={(e) => { onUpdate(claim.claim_id, { bucket: e.target.value }); setEditing(false); }}
            onBlur={() => setEditing(false)}
            autoFocus
            className="text-xs border border-stone-300 rounded px-1 h-6"
          >
            {["A", "B", "C", "D", "E"].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditing(true)}>
            <BucketBadge bucket={claim.bucket} small />
          </button>
        )}
        {claim.manual_override && <span className="ml-1 text-[10px] text-stone-500">(override)</span>}
      </td>
      <td className="px-4 py-2 text-right font-mono num">{fmtUSD(claim.allowed_amount, 0)}</td>
      <td className="px-4 py-2 text-xs text-stone-500">{claim.classification_source}</td>
    </tr>
  );
}

function BucketBadge({ bucket, small }) {
  const map = {
    A: { label: "A · DPC", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    B: { label: "B · Repriced", color: "bg-blue-100 text-blue-800 border-blue-200" },
    C: { label: "C · Indemnity", color: "bg-violet-100 text-violet-800 border-violet-200" },
    D: { label: "D · Residual", color: "bg-amber-100 text-amber-800 border-amber-200" },
    E: { label: "E · Stop-Loss", color: "bg-rose-100 text-rose-800 border-rose-200" },
  };
  const x = map[bucket] || { label: "—", color: "bg-stone-100 text-stone-600 border-stone-200" };
  return (
    <span className={`inline-flex items-center font-medium border rounded ${x.color} ${small ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5"}`}>
      {x.label}
    </span>
  );
}

/* ---------------------------------------------------------------------
 *  SCENARIO SCREEN
 * ------------------------------------------------------------------- */

function ScenarioScreen({ scenario, onChange, onPreset }) {
  const set = (k, v) => onChange({ ...scenario, [k]: v });

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Scenario Controls</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Adjust assumptions to see how each lever affects the deterministic classification output and the OffPlan stack components. Outputs recalculate live. Note: in production, the stochastic layer replaces the Risk Margin placeholder with simulation-based Min Required Liquidity.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {Object.entries(SCENARIO_PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => onPreset(key)}
            className={`text-left p-4 rounded-lg border transition ${
              scenario.name === p.name
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white border-stone-200 hover:border-stone-400"
            }`}
          >
            <div className="font-medium mb-1">{p.name}</div>
            <div className={`text-xs ${scenario.name === p.name ? "text-stone-300" : "text-stone-600"}`}>
              {p.description}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-8 space-y-6">
        <h3 className="font-display text-2xl mb-2">Levers</h3>

        <Slider
          label="DPC Elimination"
          tooltip="Share of bucket A (Primary Care, Lab) absorbed into the DPC membership"
          value={scenario.dpc_elimination_pct} min={0} max={1} step={0.05}
          format={(v) => fmtPct(v, 0)}
          onChange={(v) => set("dpc_elimination_pct", v)}
        />
        <Slider
          label="Urgent Care Reduction"
          tooltip="Reduction in urgent care utilization due to same-day DPC access"
          value={scenario.urgent_care_reduction_pct} min={0} max={1} step={0.05}
          format={(v) => fmtPct(v, 0)}
          onChange={(v) => set("urgent_care_reduction_pct", v)}
        />
        <Slider
          label="ER Reduction"
          tooltip="Avoidable ER visits prevented by DPC access and chronic care management"
          value={scenario.er_reduction_pct} min={0} max={1} step={0.05}
          format={(v) => fmtPct(v, 0)}
          onChange={(v) => set("er_reduction_pct", v)}
        />
        <Slider
          label="Cash-Pay Discount Factor"
          tooltip="Default repriced cost as fraction of original allowed amount (lower = bigger discount)"
          value={scenario.cashpay_discount_factor} min={0.2} max={1} step={0.05}
          format={(v) => fmtPct(v, 0)}
          onChange={(v) => set("cashpay_discount_factor", v)}
        />

        <div className="grid grid-cols-2 gap-6 pt-2">
          <Field label="Specific Stop-Loss Attachment Point">
            <input
              type="number" value={scenario.attachment_point}
              onChange={(e) => set("attachment_point", Number(e.target.value))}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
            />
          </Field>
          <Field label="Stop-Loss PEPM (estimate)">
            <input
              type="number" value={scenario.stop_loss_pepm}
              onChange={(e) => set("stop_loss_pepm", Number(e.target.value))}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
            />
          </Field>
        </div>

        <Slider
          label="Risk Margin (deprecated — placeholder until stochastic layer ships)"
          tooltip="v3.0/v3.1 deterministic margin. Replaced in production by P95 of max rolling 30-day Net Drawdown from the stochastic simulator. Adjust here only for scenario-sizing demos."
          value={scenario.risk_margin} min={1.0} max={1.6} step={0.05}
          format={(v) => `${v.toFixed(2)}x`}
          onChange={(v) => set("risk_margin", v)}
        />

        <div className="flex items-center gap-3 pt-4 border-t border-stone-200">
          <input
            type="checkbox"
            checked={scenario.indemnity_enabled}
            onChange={(e) => set("indemnity_enabled", e.target.checked)}
            id="indemnity_enabled"
            className="w-4 h-4"
          />
          <label htmlFor="indemnity_enabled" className="text-sm">
            <span className="font-medium">Indemnity layer enabled</span>
            <span className="text-stone-500"> · cash benefits offset ER, hospital, imaging events</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, tooltip, value, min, max, step, format, onChange }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-stone-900">{label}</div>
          {tooltip && <div className="text-xs text-stone-500 mt-0.5">{tooltip}</div>}
        </div>
        <div className="font-mono num text-lg text-stone-900">{format(value)}</div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-stone-900"
      />
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  DASHBOARD SCREEN
 * ------------------------------------------------------------------- */

function DashboardScreen({ employer, scenario, result, classifiedClaims, onScenarioChange,
                           inputModeRecord, activePricingVersion, activeRuleVersion,
                           activeIndemnityVersion, activeBenchmarkVersion }) {
  if (!result) {
    return (
      <EmptyState
        title="No data yet"
        description="Upload claims data or generate a modeled dataset to see the dashboard."
        ctaLabel=""
        onAction={() => {}}
      />
    );
  }

  const a = result.aggregates;
  const lives = Number(employer?.covered_lives) || 1;
  const residualPEPM = a.residual_fund / lives / 12;
  const recommendedPEPM = residualPEPM * scenario.risk_margin;
  const totalOffPlanPEPM = OFFPLAN_MEMBERSHIP_PEPM + recommendedPEPM + scenario.stop_loss_pepm + TPA_PEPM;
  const totalOffPlanAnnual = totalOffPlanPEPM * lives * 12;
  // Savings baseline = current total healthcare spend (REQUIRED).
  // No fallback. If absent, savings cannot be calculated and the savings UI is suppressed.
  // Historical claims are used only for reclassification modeling, NEVER as the savings baseline.
  const rawBaseline = Number(employer?.current_total_healthcare_spend);
  const hasValidBaseline = rawBaseline > 0;
  const savingsBaseline = hasValidBaseline ? rawBaseline : null;
  const annualSavings = hasValidBaseline ? savingsBaseline - totalOffPlanAnnual : null;
  const savingsPct = hasValidBaseline && savingsBaseline > 0 ? annualSavings / savingsBaseline : null;

  // Run all three scenarios for comparison
  const scenarioComparison = useMemo(() => {
    return Object.entries(SCENARIO_PRESETS).map(([key, preset]) => {
      const r = runCalculation(classifiedClaims, preset, DEFAULT_CASH_PRICES, DEFAULT_INDEMNITY_BENEFITS, DEFAULT_REPRICE_FACTORS);
      const resPEPM = r.aggregates.residual_fund / lives / 12;
      const recPEPM = resPEPM * preset.risk_margin;
      const totalPEPM = OFFPLAN_MEMBERSHIP_PEPM + recPEPM + preset.stop_loss_pepm + TPA_PEPM;
      return {
        key,
        name: preset.name,
        residualPEPM: resPEPM,
        recommendedPEPM: recPEPM,
        stopLossPEPM: preset.stop_loss_pepm,
        totalPEPM,
        annualTotal: totalPEPM * lives * 12,
        residualFund: r.aggregates.residual_fund,
        stopLossShift: r.aggregates.stop_loss_shift,
      };
    });
  }, [classifiedClaims, lives]);

  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Reclassification</h1>
          <p className="text-stone-600 max-w-2xl">
            What used to be claims, repositioned under the OffPlan model.
          </p>
        </div>
        <div className="text-right space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500">Active Scenario</div>
            <div className="font-display text-2xl">{scenario.name}</div>
          </div>
          {inputModeRecord && (
            <div className="flex justify-end">
              <InputModeBadge inputModeRecord={inputModeRecord} inline />
            </div>
          )}
        </div>
      </div>

      {/* Hero metric — Residual PEPM */}
      {/* Spec-status banner: tells the reader exactly what this prototype does and does NOT compute. */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm text-amber-900">
        <div className="flex gap-2">
          <AlertTriangle size={16} className="text-amber-700 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Prototype scope: deterministic classification layer only.</strong>
            <div className="mt-1 leading-relaxed">
              This reference implementation produces the residual fund (the dollars that remain after every OffPlan transformation) and the OffPlan stack PEPM. The headline capital output specified in Master Spec v3.3 — <strong>Minimum Required Liquidity</strong> with bootstrap confidence bands — is computed by the stochastic capital layer (Modules 6, 7, 9, 10, 11 per Liquidity Spec v1.2) which is not yet implemented in this prototype. The "Risk Margin × Residual" formula shown below is the deprecated v3.0/v3.1 funding construct retained here only as an intermediate placeholder until the stochastic layer ships.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-stone-900 text-white rounded-lg p-8 mb-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual Fund · Annual</div>
          <div className="font-display text-5xl mb-1 num">{fmtUSD(a.residual_fund)}</div>
          <div className="text-sm text-stone-300">
            Intermediate output · feeds the stochastic layer
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual PEPM</div>
          <div className="font-display text-5xl mb-1 num">{fmtUSD(residualPEPM, 2)}</div>
          <div className="text-sm text-stone-300">
            Per employee per month · pre-stochastic
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
            Min Required Liquidity <span className="text-amber-300 font-normal">· not yet computed</span>
          </div>
          <div className="font-display text-5xl mb-1 num text-stone-500">—</div>
          <div className="text-sm text-stone-400">
            Produced by stochastic layer (Modules 6–11) · not in this prototype
          </div>
        </div>
      </div>

      {/* Deprecated intermediate placeholder — kept visible so the operator can see the v3.0 formula
          but clearly labeled as not the headline. */}
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 mb-6 text-xs text-stone-600">
        <div className="uppercase tracking-wider text-[10px] text-stone-500 mb-1">Deprecated intermediate placeholder (v3.0/v3.1)</div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span>Residual PEPM × {scenario.risk_margin.toFixed(2)}x risk margin =</span>
          <span className="font-mono num text-stone-800 font-semibold">{fmtUSD(recommendedPEPM, 2)} PEPM</span>
          <span className="text-stone-500">— used for scenario sizing only; not a headline output.</span>
        </div>
      </div>

      {/* Transformation flow */}
      <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
        <h3 className="font-medium text-stone-900 mb-1">Where the historical claims went</h3>
        <p className="text-xs text-stone-500 mb-5">
          Each segment shows what happened to that portion of the original {fmtUSD(a.historical_claims)} in claims.
        </p>
        <FlowChart aggregates={a} historical={a.historical_claims} />
      </div>

      {/* ---- BASELINE COMPARISON MATRIX (per spec) ---- */}
      <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-medium text-stone-900 mb-1">Baseline Comparison</h3>
            <p className="text-xs text-stone-500 max-w-2xl leading-relaxed">
              Savings are calculated against current total healthcare spend, not claims-only spend.
              Historical claims drive the reclassification model; total spend drives the savings comparison.
            </p>
          </div>
          {employer?.current_funding_model && (
            <div className="text-right text-[11px] text-stone-500">
              <div className="uppercase tracking-wider">Funding Model</div>
              <div className="font-medium text-stone-700 normal-case">
                {employer.plan_type}{employer.baseline_confidence ? ` · ${employer.baseline_confidence} confidence` : ""}
              </div>
            </div>
          )}
        </div>

        <div className="border border-stone-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
                <th className="text-left px-4 py-2.5 font-medium">Metric</th>
                <th className="text-left px-4 py-2.5 font-medium">Purpose</th>
                <th className="text-right px-4 py-2.5 font-medium">Annual</th>
                <th className="text-right px-4 py-2.5 font-medium">PEPM</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-3 font-medium text-stone-900">Historical Claims</td>
                <td className="px-4 py-3 text-stone-600">Reclassification modeling</td>
                <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.historical_claims)}</td>
                <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(a.historical_claims / lives / 12, 2)}</td>
              </tr>
              {hasValidBaseline ? (
                <>
                  <tr className="border-b border-stone-100 bg-stone-50/40">
                    <td className="px-4 py-3 font-medium text-stone-900">Current Total Healthcare Spend</td>
                    <td className="px-4 py-3 text-stone-600">Savings comparison baseline</td>
                    <td className="px-4 py-3 text-right font-mono num">{fmtUSD(savingsBaseline)}</td>
                    <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(savingsBaseline / lives / 12, 2)}</td>
                  </tr>
                  <tr className="border-b border-stone-100">
                    <td className="px-4 py-3 font-medium text-stone-900">OffPlan Total Stack</td>
                    <td className="px-4 py-3 text-stone-600">New model</td>
                    <td className="px-4 py-3 text-right font-mono num">{fmtUSD(totalOffPlanAnnual)}</td>
                    <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(totalOffPlanPEPM, 2)}</td>
                  </tr>
                  <tr className="bg-emerald-50/40">
                    <td className="px-4 py-3 font-semibold text-emerald-900">Net Savings</td>
                    <td className="px-4 py-3 text-emerald-800">Total spend minus OffPlan stack</td>
                    <td className={`px-4 py-3 text-right font-mono num font-semibold ${annualSavings >= 0 ? "text-emerald-800" : "text-rose-700"}`}>
                      {fmtUSD(annualSavings)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono num ${annualSavings >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtPct(savingsPct)}
                    </td>
                  </tr>
                </>
              ) : (
                <tr className="border-b border-stone-100">
                  <td className="px-4 py-3 font-medium text-stone-900">OffPlan Total Stack</td>
                  <td className="px-4 py-3 text-stone-600">New model</td>
                  <td className="px-4 py-3 text-right font-mono num">{fmtUSD(totalOffPlanAnnual)}</td>
                  <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(totalOffPlanPEPM, 2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!hasValidBaseline && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-900 flex gap-2">
            <AlertTriangle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Current Total Healthcare Spend is required before savings can be calculated.</strong> Historical claims are used only for reclassification modeling and cannot be used as the savings baseline. Add Current Total Healthcare Spend in Setup to enable savings calculations and PDF export.
            </div>
          </div>
        )}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard
          icon={DollarSign} accent="stone"
          label="Historical Claims" value={fmtUSD(a.historical_claims)}
          sub={`${fmtNum(classifiedClaims.length)} lines · for modeling`}
        />
        <KPICard
          icon={TrendingDown} accent="emerald"
          label="DPC Eliminated" value={fmtUSD(a.dpc_eliminated)}
          sub={`${fmtPct(a.dpc_eliminated / a.historical_claims)} of historical`}
        />
        <KPICard
          icon={Zap} accent="blue"
          label="Cash-Pay Repricing" value={fmtUSD(a.repriced_savings)}
          sub="Specialty, imaging, procedures"
        />
        <KPICard
          icon={Activity} accent="violet"
          label="ER + Indemnity Offset"
          value={fmtUSD(a.er_reduction_savings + a.indemnity_offset)}
          sub={`Cash benefits: ${fmtUSD(a.indemnity_offset)}`}
        />
        <KPICard
          icon={Shield} accent="rose"
          label="Stop-Loss Shift" value={fmtUSD(a.stop_loss_shift)}
          sub="Above attachment point"
        />
        <KPICard
          icon={Target} accent="amber"
          label="Residual Fund" value={fmtUSD(a.residual_fund)}
          sub={`${fmtUSD(residualPEPM, 2)} PEPM`}
        />
        <KPICard
          icon={DollarSign} accent="stone"
          label="Total OffPlan PEPM"
          value={fmtUSD(totalOffPlanPEPM, 2)}
          sub={`Membership + Funding (placeholder) + S/L + TPA`}
        />
        <KPICard
          icon={Users} accent="emerald"
          label="Estimated Savings"
          value={hasValidBaseline ? fmtUSD(annualSavings) : "—"}
          sub={hasValidBaseline ? `${fmtPct(savingsPct)} reduction` : "Total Healthcare Spend required"}
        />
      </div>

      {/* Scenario comparison */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <h3 className="font-medium text-stone-900">Scenario Comparison</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">Scenario</th>
              <th className="text-right px-5 py-3">Residual Fund</th>
              <th className="text-right px-5 py-3">Stop-Loss Shift</th>
              <th className="text-right px-5 py-3">Residual PEPM</th>
              <th className="text-right px-5 py-3">Total OffPlan PEPM</th>
              <th className="text-right px-5 py-3">Annual Total</th>
            </tr>
          </thead>
          <tbody>
            {scenarioComparison.map((s) => (
              <tr key={s.key} className={`border-b border-stone-100 ${s.name === scenario.name ? "bg-stone-50" : ""}`}>
                <td className="px-5 py-3">
                  <div className="font-medium">{s.name}</div>
                  {s.name === scenario.name && (
                    <div className="text-xs text-emerald-700">Active</div>
                  )}
                </td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.residualFund)}</td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.stopLossShift)}</td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.residualPEPM, 2)}</td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.totalPEPM, 2)}</td>
                <td className="px-5 py-3 text-right font-mono num font-medium">{fmtUSD(s.annualTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Provenance footer */}
      <div className="bg-white border border-stone-200 rounded-lg p-5 mt-6">
        <ProvenanceFooter
          inputModeRecord={inputModeRecord}
          pricingVersion={activePricingVersion}
          ruleVersion={activeRuleVersion}
          indemnityVersion={activeIndemnityVersion}
          benchmarkVersion={activeBenchmarkVersion}
          scenario={scenario}
          claims={classifiedClaims}
        />
      </div>
    </div>
  );
}

function KPICard({ icon: Icon, accent, label, value, sub }) {
  const accents = {
    stone: "text-stone-700 bg-stone-100",
    emerald: "text-emerald-700 bg-emerald-100",
    blue: "text-blue-700 bg-blue-100",
    violet: "text-violet-700 bg-violet-100",
    amber: "text-amber-700 bg-amber-100",
    rose: "text-rose-700 bg-rose-100",
  };
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded grid place-items-center ${accents[accent]}`}>
          <Icon size={12} />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      </div>
      <div className="font-mono num text-2xl text-stone-900 mb-1">{value}</div>
      <div className="text-xs text-stone-500">{sub}</div>
    </div>
  );
}

function FlowChart({ aggregates: a, historical }) {
  const segments = [
    { label: "DPC Eliminated", value: a.dpc_eliminated, color: "bg-emerald-500", text: "text-emerald-900" },
    { label: "Repriced Savings", value: a.repriced_savings, color: "bg-blue-500", text: "text-blue-900" },
    { label: "ER Reduction", value: a.er_reduction_savings, color: "bg-violet-400", text: "text-violet-900" },
    { label: "Indemnity Offset", value: a.indemnity_offset, color: "bg-violet-600", text: "text-violet-900" },
    { label: "Stop-Loss Shift", value: a.stop_loss_shift, color: "bg-rose-500", text: "text-rose-900" },
    { label: "Residual Fund", value: a.residual_fund, color: "bg-amber-500", text: "text-amber-900" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="h-12 rounded overflow-hidden flex border border-stone-200">
        {segments.map((s) => {
          const pct = (s.value / historical) * 100;
          return (
            <div
              key={s.label}
              className={`${s.color} relative group`}
              style={{ width: `${pct}%`, minWidth: pct > 0.5 ? "auto" : "0" }}
            >
              {pct > 8 && (
                <div className="absolute inset-0 px-2 flex items-center text-xs text-white font-medium truncate">
                  {fmtPct(s.value / historical, 0)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-4">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-sm ${s.color}`} />
            <div className="text-xs">
              <span className="text-stone-700">{s.label}: </span>
              <span className="font-mono num text-stone-900">{fmtUSD(s.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  REPORT SCREEN
 * ------------------------------------------------------------------- */

function ReportScreen({ employer, scenario, result, classifiedClaims, inputModeRecord,
                        activePricingVersion, activeRuleVersion, activeIndemnityVersion, activeBenchmarkVersion }) {
  if (!result || !employer) return <div className="text-stone-500">No data to report.</div>;

  const a = result.aggregates;
  const lives = Number(employer.covered_lives) || 1;
  const residualPEPM = a.residual_fund / lives / 12;
  const recommendedPEPM = residualPEPM * scenario.risk_margin;
  const totalOffPlanPEPM = OFFPLAN_MEMBERSHIP_PEPM + recommendedPEPM + scenario.stop_loss_pepm + TPA_PEPM;
  const totalOffPlanAnnual = totalOffPlanPEPM * lives * 12;
  // Strict: Current Total Healthcare Spend is REQUIRED before any savings output or PDF export.
  // No fallback to historical claims. Historical claims are reclassification-modeling input only.
  const rawBaseline = Number(employer.current_total_healthcare_spend);
  const hasValidBaseline = rawBaseline > 0;
  const savingsBaseline = hasValidBaseline ? rawBaseline : null;
  const annualSavings = hasValidBaseline ? savingsBaseline - totalOffPlanAnnual : null;
  const savingsPct = hasValidBaseline && savingsBaseline > 0 ? annualSavings / savingsBaseline : null;

  const print = () => window.print();

  // BLOCKING GATE: PDF export and the report itself are unavailable until baseline is set.
  if (!hasValidBaseline) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Report</h1>
          <p className="text-stone-600">Employer-ready output. Export as PDF via your browser.</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 max-w-2xl">
          <div className="flex gap-3">
            <AlertTriangle size={20} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-rose-900 mb-2">
                Current Total Healthcare Spend is required before the report can be generated.
              </div>
              <p className="text-sm text-rose-900 leading-relaxed mb-3">
                Historical claims are used only for reclassification modeling and cannot be used as the savings baseline. To produce a defensible savings report, the employer's Current Total Healthcare Spend (annual premium for fully insured, total plan cost for self-funded) must be entered in the Setup screen.
              </p>
              <p className="text-xs text-rose-800">
                This safeguard prevents the report from displaying savings figures derived from an inappropriate comparison basis.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Report</h1>
          <p className="text-stone-600">Employer-ready output. Export as PDF via your browser.</p>
        </div>
        <button
          onClick={print}
          className="bg-stone-900 text-white px-5 h-11 rounded font-medium hover:bg-stone-800 flex items-center gap-2"
        >
          <FileDown size={16} /> Export PDF
        </button>
      </div>

      <div id="report-doc" className="bg-white border border-stone-200 rounded-lg p-12 print:border-0 print:p-0 print:shadow-none">
        {/* Letterhead */}
        <div className="flex items-center justify-between border-b border-stone-300 pb-6 mb-8">
          <div>
            <div className="font-display text-3xl">OffPlan</div>
            <div className="text-xs uppercase tracking-[0.18em] text-stone-500">
              Claims Reclassification Report
            </div>
          </div>
          <div className="text-right text-xs text-stone-500 space-y-2">
            <div>Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            <div>Confidential</div>
            {inputModeRecord && (
              <div className="flex justify-end">
                <InputModeBadge inputModeRecord={inputModeRecord} inline />
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <h1 className="font-display text-5xl text-stone-900 mb-2 leading-tight">
          {employer.name}
        </h1>
        <div className="text-sm text-stone-600 mb-8">
          {employer.industry || "—"} · {employer.state} · {fmtNum(employer.covered_lives)} covered lives
          · Period: {employer.claims_period_start} to {employer.claims_period_end}
        </div>

        {/* Lead-in narrative */}
        <p className="text-base text-stone-800 leading-relaxed mb-8 max-w-3xl">
          The historical claims data shows {fmtUSD(a.historical_claims)} in spend across {fmtNum(result.claims.length)} line items.
          Under the OffPlan model, the majority of this spend is no longer processed as claims at all.
          The headline output of this analysis is the capital requirement: how much liquidity an employer must hold to operate safely. The intermediate residual fund (the dollars that survive every transformation) feeds the stochastic layer, which produces the final Minimum Required Liquidity number.
        </p>

        {/* Prototype-scope disclosure: visible in the printed PDF so reviewers know what is and is not computed. */}
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-8 text-xs text-amber-900 leading-relaxed">
          <strong>Prototype scope:</strong> This report shows the deterministic classification layer of the OffPlan engine — the residual fund and the OffPlan stack PEPM. The headline capital output specified in OffPlan's engine spec (Minimum Required Liquidity with bootstrap confidence bands, Capital Efficiency Ratio, Liquidity Coverage Ratio) is produced by the stochastic capital layer which is under development and not represented in this prototype output. Numbers below are intermediate and intended for engine demonstration purposes.
        </div>

        {/* Hero numbers */}
        <div className="bg-stone-900 text-white rounded-lg p-8 mb-10">
          <div className="grid grid-cols-3 gap-8">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual Fund · Intermediate</div>
              <div className="font-display text-4xl mb-1 num">{fmtUSD(a.residual_fund)}</div>
              <div className="text-xs text-stone-400">vs {fmtUSD(a.historical_claims)} historical claims · feeds stochastic layer</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual PEPM · Pre-Stochastic</div>
              <div className="font-display text-4xl mb-1 num">{fmtUSD(residualPEPM, 2)}</div>
              <div className="text-xs text-stone-400">deprecated v3.0 placeholder: {fmtUSD(recommendedPEPM, 2)} with {scenario.risk_margin.toFixed(2)}x margin</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Net Annual Savings</div>
              <div className={`font-display text-4xl mb-1 num ${annualSavings >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtUSD(annualSavings)}</div>
              <div className="text-xs text-stone-400">{fmtPct(savingsPct)} vs current total spend</div>
            </div>
          </div>
        </div>

        {/* Baseline disclosure block */}
        <div className="border border-stone-200 rounded-lg p-5 mb-10 bg-stone-50">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-2">Comparison Basis</div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Current Funding Model</td>
                <td className="py-2 text-right font-medium">{employer.plan_type || "—"}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Historical Claims (modeling input)</td>
                <td className="py-2 text-right font-mono num">{fmtUSD(a.historical_claims)}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Current Total Healthcare Spend (savings baseline)</td>
                <td className="py-2 text-right font-mono num">{fmtUSD(savingsBaseline)}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">OffPlan Total Stack</td>
                <td className="py-2 text-right font-mono num">{fmtUSD(totalOffPlanAnnual)}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold text-stone-900">Net Savings</td>
                <td className={`py-2 text-right font-mono num font-semibold ${annualSavings >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmtUSD(annualSavings)} ({fmtPct(savingsPct)})
                </td>
              </tr>
            </tbody>
          </table>
          <div className="text-[11px] text-stone-500 mt-3 leading-relaxed">
            Savings are calculated against current total healthcare spend, not claims-only spend.
            For fully insured employers, this is total annual premium. For self-funded employers, this includes
            claims paid, TPA fees, network access, stop-loss premium, PBM/admin fees, and other plan costs.
          </div>
        </div>

        {/* Reclassification table */}
        <h2 className="font-display text-3xl mb-1">Reclassification Detail</h2>
        <p className="text-sm text-stone-600 mb-5">
          Every dollar of historical spend has been routed to one of five outcomes.
        </p>
        <table className="w-full text-sm border border-stone-200 rounded mb-10">
          <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
            <tr>
              <th className="text-left px-4 py-3 border-b border-stone-200">Bucket</th>
              <th className="text-left px-4 py-3 border-b border-stone-200">Treatment</th>
              <th className="text-right px-4 py-3 border-b border-stone-200">Amount</th>
              <th className="text-right px-4 py-3 border-b border-stone-200">% of Historical</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="A" /></td>
              <td className="px-4 py-3">Eliminated through DPC membership</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.dpc_eliminated)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct(a.dpc_eliminated / a.historical_claims)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="B" /></td>
              <td className="px-4 py-3">Cash-pay repriced (specialty, imaging, procedures)</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.repriced_savings)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct(a.repriced_savings / a.historical_claims)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="C" /></td>
              <td className="px-4 py-3">ER reduction + indemnity cash benefits</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.er_reduction_savings + a.indemnity_offset)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct((a.er_reduction_savings + a.indemnity_offset) / a.historical_claims)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="E" /></td>
              <td className="px-4 py-3">Shifted to stop-loss (above attachment point)</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.stop_loss_shift)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct(a.stop_loss_shift / a.historical_claims)}</td>
            </tr>
            <tr className="bg-amber-50 border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="D" /></td>
              <td className="px-4 py-3 font-medium">Residual: requires funding as claims</td>
              <td className="px-4 py-3 text-right font-mono num font-medium">{fmtUSD(a.residual_fund)}</td>
              <td className="px-4 py-3 text-right font-mono num font-medium">{fmtPct(a.residual_fund / a.historical_claims)}</td>
            </tr>
          </tbody>
        </table>

        {/* PEPM stack */}
        <h2 className="font-display text-3xl mb-1">Total Cost Stack</h2>
        <p className="text-sm text-stone-600 mb-5">
          What the employer pays per employee per month under OffPlan.
        </p>
        <table className="w-full text-sm border border-stone-200 rounded mb-10">
          <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
            <tr>
              <th className="text-left px-4 py-3 border-b border-stone-200">Component</th>
              <th className="text-left px-4 py-3 border-b border-stone-200">Function</th>
              <th className="text-right px-4 py-3 border-b border-stone-200">PEPM</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">OffPlan Membership</td>
              <td className="px-4 py-3 text-stone-600">Unlimited primary care, chronic management, navigation</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(OFFPLAN_MEMBERSHIP_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">Residual Funding · placeholder</td>
              <td className="px-4 py-3 text-stone-600">v3.0 deterministic placeholder ({scenario.risk_margin.toFixed(2)}x margin) · production replaces with stochastic Min Required Liquidity</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(recommendedPEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">Stop-Loss</td>
              <td className="px-4 py-3 text-stone-600">Catastrophic protection above {fmtUSD(scenario.attachment_point)}</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(scenario.stop_loss_pepm, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">TPA</td>
              <td className="px-4 py-3 text-stone-600">Claims administration for non-DPC services</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(TPA_PEPM, 2)}</td>
            </tr>
            <tr className="bg-stone-50 border-b border-stone-100 font-medium">
              <td className="px-4 py-3">Total OffPlan PEPM</td>
              <td className="px-4 py-3 text-stone-600">Per employee per month</td>
              <td className="px-4 py-3 text-right font-mono num text-lg">{fmtUSD(totalOffPlanPEPM, 2)}</td>
            </tr>
          </tbody>
        </table>

        {/* Scenario assumptions */}
        <h2 className="font-display text-3xl mb-1">Scenario Assumptions</h2>
        <p className="text-sm text-stone-600 mb-5">
          {scenario.name} scenario. {SCENARIO_PRESETS[scenario.name?.toLowerCase()]?.description || ""}
        </p>
        <table className="w-full text-sm border border-stone-200 rounded mb-10">
          <tbody>
            <AssumptionRow label="DPC Elimination" value={fmtPct(scenario.dpc_elimination_pct)} />
            <AssumptionRow label="Urgent Care Reduction" value={fmtPct(scenario.urgent_care_reduction_pct)} />
            <AssumptionRow label="ER Reduction" value={fmtPct(scenario.er_reduction_pct)} />
            <AssumptionRow label="Cash-Pay Discount Factor" value={fmtPct(scenario.cashpay_discount_factor)} />
            <AssumptionRow label="Indemnity Layer" value={scenario.indemnity_enabled ? "Enabled" : "Disabled"} />
            <AssumptionRow label="Stop-Loss Attachment Point" value={fmtUSD(scenario.attachment_point)} />
            <AssumptionRow label="Stop-Loss PEPM" value={fmtUSD(scenario.stop_loss_pepm, 2)} />
            <AssumptionRow label="Risk Margin (deprecated · placeholder only)" value={`${scenario.risk_margin.toFixed(2)}x`} />
          </tbody>
        </table>

        {/* Footer */}
        <div className="border-t border-stone-300 pt-6 text-xs text-stone-500 leading-relaxed">
          <strong className="text-stone-700">Important: </strong>
          This report represents the deterministic classification layer of the OffPlan engine. It is not an insurance quote and is not a substitute for the stochastic capital analysis specified in OffPlan's Liquidity & Capital Modeling Specification v1.2. The headline capital output (Minimum Required Liquidity with bootstrap confidence bands, Capital Efficiency Ratio, Liquidity Coverage Ratio, Stress Coverage Ratio) is produced by the stochastic layer (Modules 6, 7, 9, 10, 11) which is under development. The Residual Fund shown here is an intermediate output that feeds the stochastic layer. Stop-loss premiums, attachment points, and indemnity benefits are illustrative and must be confirmed with underwriting partners. The "Risk Margin" multiplier is the deprecated v3.0/v3.1 deterministic funding placeholder, retained in this prototype for scenario sizing only and replaced in production by stochastic simulation outputs.
        </div>

        {/* Provenance footer (per Data Dictionary v2 §6) */}
        <div className="border-t border-stone-200 pt-4 mt-4">
          <ProvenanceFooter
            inputModeRecord={inputModeRecord}
            pricingVersion={activePricingVersion}
            ruleVersion={activeRuleVersion}
            indemnityVersion={activeIndemnityVersion}
            benchmarkVersion={activeBenchmarkVersion}
            scenario={scenario}
            claims={classifiedClaims}
            compact
          />
        </div>
      </div>
    </div>
  );
}

function AssumptionRow({ label, value }) {
  return (
    <tr className="border-b border-stone-100">
      <td className="px-4 py-2.5 text-stone-600">{label}</td>
      <td className="px-4 py-2.5 text-right font-mono num">{value}</td>
    </tr>
  );
}

/* ---------------------------------------------------------------------
 *  ADMIN SCREEN
 * ------------------------------------------------------------------- */

function AdminScreen({ cptRules, cashPrices, indemnityBenefits, repriceFactors,
                       pricingVersions, ruleVersions, indemnityVersions, benchmarkVersions, auditLog,
                       onUpdateCashPrices, onUpdateIndemnity, onUpdateRepriceFactors }) {
  const [tab, setTab] = useState("cash");

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Admin Control</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Configure the economic assumptions that drive every calculation. Every change creates a new immutable version. Past versions are never deleted.
      </p>

      <div className="flex border border-stone-200 rounded overflow-hidden mb-6 inline-flex">
        {[
          { id: "cash", label: "Cash-Pay Pricing" },
          { id: "indemnity", label: "Indemnity Benefits" },
          { id: "reprice", label: "Default Repricing" },
          { id: "rules", label: "CPT Rules" },
          { id: "versions", label: "Versions" },
          { id: "audit", label: "Audit Log" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 h-10 text-sm font-medium ${
              tab === t.id ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cash" && (
        <CashPriceTable cashPrices={cashPrices} onChange={onUpdateCashPrices} />
      )}
      {tab === "indemnity" && (
        <IndemnityTable indemnityBenefits={indemnityBenefits} onChange={onUpdateIndemnity} />
      )}
      {tab === "reprice" && (
        <RepriceFactorTable factors={repriceFactors} onChange={onUpdateRepriceFactors} />
      )}
      {tab === "rules" && (
        <CPTRulesTable rules={cptRules} />
      )}
      {tab === "versions" && (
        <VersionsTable
          pricingVersions={pricingVersions}
          ruleVersions={ruleVersions}
          indemnityVersions={indemnityVersions}
          benchmarkVersions={benchmarkVersions}
        />
      )}
      {tab === "audit" && (
        <AuditLogTable entries={auditLog} />
      )}
    </div>
  );
}

function VersionsTable({ pricingVersions, ruleVersions, indemnityVersions, benchmarkVersions }) {
  const groups = [
    { title: "Pricing Versions", subtitle: "Cash-pay reference prices", versions: pricingVersions },
    { title: "Rule Versions", subtitle: "CPT/POS/specialty bucket mapping + repricing factors", versions: ruleVersions },
    { title: "Indemnity Versions", subtitle: "Cash benefit schedule (ER, hospital, imaging, ambulance)", versions: indemnityVersions },
    { title: "Benchmark Versions", subtitle: "Mode 3 modeled distributions", versions: benchmarkVersions },
  ];
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.title} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
            <h3 className="font-medium text-stone-900">{g.title}</h3>
            <p className="text-xs text-stone-500">{g.subtitle}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
              <tr>
                <th className="text-left px-5 py-2">Version</th>
                <th className="text-left px-5 py-2">Status</th>
                <th className="text-left px-5 py-2">Effective</th>
                <th className="text-left px-5 py-2">Created By</th>
                <th className="text-left px-5 py-2">Change Summary</th>
              </tr>
            </thead>
            <tbody>
              {(g.versions || []).map((v) => (
                <tr key={v.id} className="border-b border-stone-100">
                  <td className="px-5 py-3 font-mono text-xs">{v.version_label}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-medium ${
                      v.status === "active" ? "bg-emerald-100 text-emerald-800" :
                      v.status === "draft" ? "bg-amber-100 text-amber-800" :
                      "bg-stone-100 text-stone-600"
                    }`}>{v.status}</span>
                  </td>
                  <td className="px-5 py-3 text-stone-700">{new Date(v.effective_at).toISOString().slice(0, 10)}</td>
                  <td className="px-5 py-3 text-stone-700">{v.created_by}</td>
                  <td className="px-5 py-3 text-stone-600 text-xs">{v.change_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function AuditLogTable({ entries }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium text-stone-900">Audit Log</h3>
        <p className="text-xs text-stone-500">Append-only. {entries.length} entries.</p>
      </div>
      {entries.length === 0 ? (
        <div className="px-5 py-12 text-center text-stone-500 text-sm">No audit entries yet. Admin actions will appear here.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
            <tr>
              <th className="text-left px-5 py-2">When</th>
              <th className="text-left px-5 py-2">Actor</th>
              <th className="text-left px-5 py-2">Action</th>
              <th className="text-left px-5 py-2">Entity</th>
              <th className="text-left px-5 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-stone-100">
                <td className="px-5 py-3 text-xs font-mono text-stone-600">{new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="px-5 py-3 text-stone-700">{e.actor_user_id} <span className="text-stone-400">· {e.actor_role}</span></td>
                <td className="px-5 py-3">
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-medium">{e.action}</span>
                </td>
                <td className="px-5 py-3 text-stone-700 text-xs">{e.entity_type} · <span className="font-mono text-stone-500">{(e.entity_id || "").slice(0, 18)}</span></td>
                <td className="px-5 py-3 text-stone-600 text-xs">{e.change_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CashPriceTable({ cashPrices, onChange }) {
  const [adding, setAdding] = useState(false);
  const [newCpt, setNewCpt] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const update = (cpt, price) => {
    onChange({ ...cashPrices, [cpt]: Number(price) });
  };
  const remove = (cpt) => {
    const next = { ...cashPrices };
    delete next[cpt];
    onChange(next);
  };
  const add = () => {
    if (!newCpt || !newPrice) return;
    onChange({ ...cashPrices, [newCpt]: Number(newPrice) });
    setNewCpt(""); setNewPrice(""); setAdding(false);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">Cash-Pay Reference Prices</h3>
        <button onClick={() => setAdding(true)} className="text-sm flex items-center gap-1 text-stone-700 hover:text-stone-900">
          <Plus size={14} /> Add CPT
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
          <tr>
            <th className="text-left px-5 py-2">CPT Code</th>
            <th className="text-right px-5 py-2">Cash Price</th>
            <th className="px-5 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr className="border-b border-stone-100 bg-blue-50">
              <td className="px-5 py-2"><input value={newCpt} onChange={(e) => setNewCpt(e.target.value)} placeholder="CPT" className="w-24 border border-stone-300 rounded px-2 h-7 text-xs font-mono" /></td>
              <td className="px-5 py-2 text-right"><input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0" className="w-24 border border-stone-300 rounded px-2 h-7 text-xs font-mono num text-right" /></td>
              <td className="px-5 py-2 text-right">
                <button onClick={add} className="text-emerald-700 mr-2"><Check size={14} /></button>
                <button onClick={() => setAdding(false)} className="text-stone-500"><X size={14} /></button>
              </td>
            </tr>
          )}
          {Object.entries(cashPrices).sort(([a], [b]) => a.localeCompare(b)).map(([cpt, price]) => (
            <tr key={cpt} className="border-b border-stone-100 hover:bg-stone-50">
              <td className="px-5 py-2 font-mono text-xs">{cpt}</td>
              <td className="px-5 py-2 text-right">
                <input
                  type="number" value={price}
                  onChange={(e) => update(cpt, e.target.value)}
                  className="w-24 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <button onClick={() => remove(cpt)} className="text-stone-400 hover:text-red-600"><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndemnityTable({ indemnityBenefits, onChange }) {
  const update = (event, field, value) => {
    onChange({
      ...indemnityBenefits,
      [event]: { ...indemnityBenefits[event], [field]: Number(value) },
    });
  };
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">Indemnity Benefit Schedule</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
          <tr>
            <th className="text-left px-5 py-2">Event Type</th>
            <th className="text-right px-5 py-2">Benefit Amount</th>
            <th className="text-right px-5 py-2">Max Per Year</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(indemnityBenefits).map(([event, b]) => (
            <tr key={event} className="border-b border-stone-100">
              <td className="px-5 py-2 font-medium">{event}</td>
              <td className="px-5 py-2 text-right">
                <input type="number" value={b.benefit}
                  onChange={(e) => update(event, "benefit", e.target.value)}
                  className="w-28 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <input type="number" value={b.maxPerYear}
                  onChange={(e) => update(event, "maxPerYear", e.target.value)}
                  className="w-20 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepriceFactorTable({ factors, onChange }) {
  const update = (cat, value) => {
    onChange({ ...factors, [cat]: Number(value) });
  };
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">Default Repricing Factors</h3>
        <p className="text-xs text-stone-500 mt-0.5">Applied when no specific cash price exists. Lower factor means deeper discount.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
          <tr>
            <th className="text-left px-5 py-2">Category</th>
            <th className="text-right px-5 py-2">Factor (% of allowed)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(factors).map(([cat, f]) => (
            <tr key={cat} className="border-b border-stone-100">
              <td className="px-5 py-2 font-medium">{cat}</td>
              <td className="px-5 py-2 text-right">
                <input type="number" step="0.05" min="0.1" max="1" value={f}
                  onChange={(e) => update(cat, e.target.value)}
                  className="w-20 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CPTRulesTable({ rules }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">CPT Classification Rules</h3>
        <p className="text-xs text-stone-500 mt-0.5">Read-only in MVP. Future versions support adding custom CPT ranges.</p>
      </div>
      <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200 sticky top-0 bg-white">
            <tr>
              <th className="text-left px-5 py-2">CPT Range</th>
              <th className="text-left px-5 py-2">Category</th>
              <th className="text-left px-5 py-2">Bucket</th>
              <th className="text-left px-5 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i} className="border-b border-stone-100">
                <td className="px-5 py-2 font-mono text-xs">{r.range[0]}–{r.range[1]}</td>
                <td className="px-5 py-2">{r.category}</td>
                <td className="px-5 py-2"><BucketBadge bucket={r.bucket} small /></td>
                <td className="px-5 py-2 text-stone-600 text-xs">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
 *  TOAST
 * ------------------------------------------------------------------- */

function Toast({ message, type }) {
  const colors = {
    success: "bg-emerald-900 text-emerald-100",
    error: "bg-red-900 text-red-100",
    info: "bg-stone-900 text-stone-100",
  };
  const Icon = type === "success" ? Check : type === "error" ? AlertCircle : null;
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${colors[type] || colors.info} px-4 py-2.5 rounded shadow-lg flex items-center gap-2 text-sm`}>
      {Icon && <Icon size={14} />}
      {message}
    </div>
  );
}


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<ClaimsReclassificationEngine />);