(function() {
const DEFAULT_CPT_RULES = [
  // ---- Primary Care E/M (DPC eliminated) ----
  { range: ["99201", "99205"], category: "Primary Care", bucket: "A", note: "New patient office visit" },
  { range: ["99211", "99215"], category: "Primary Care", bucket: "A", note: "Established patient office visit" },
  { range: ["99381", "99397"], category: "Primary Care", bucket: "A", note: "Preventive medicine" },
  { range: ["99401", "99404"], category: "Primary Care", bucket: "A", note: "Preventive counseling" },
  { range: ["99406", "99409"], category: "Primary Care", bucket: "A", note: "Behavioral counseling" },
  { range: ["99441", "99443"], category: "Primary Care", bucket: "A", note: "Telephone E/M" },
  { range: ["G0438", "G0439"], category: "Primary Care", bucket: "A", note: "Annual wellness visit" },
  { range: ["G0444", "G0444"], category: "Primary Care", bucket: "A", note: "Depression screening" },

  // ---- Common labs (DPC eliminated when DPC includes basic labs) ----
  { range: ["80048", "80076"], category: "Lab", bucket: "A", note: "Basic metabolic panels" },
  { range: ["80061", "80061"], category: "Lab", bucket: "A", note: "Lipid panel" },
  { range: ["83036", "83037"], category: "Lab", bucket: "A", note: "Hemoglobin A1c" },
  { range: ["84443", "84443"], category: "Lab", bucket: "A", note: "TSH" },
  { range: ["85025", "85027"], category: "Lab", bucket: "A", note: "CBC" },
  { range: ["81000", "81003"], category: "Lab", bucket: "A", note: "Urinalysis" },
  { range: ["87086", "87088"], category: "Lab", bucket: "A", note: "Urine culture" },

  // ---- Imaging (Cash-pay repriced) ----
  { range: ["70450", "70498"], category: "Imaging", bucket: "B", note: "CT head/neck" },
  { range: ["71045", "71048"], category: "Imaging", bucket: "B", note: "Chest X-ray" },
  { range: ["72100", "72120"], category: "Imaging", bucket: "B", note: "Spine X-ray" },
  { range: ["72141", "72158"], category: "Imaging", bucket: "B", note: "MRI spine" },
  { range: ["73221", "73223"], category: "Imaging", bucket: "B", note: "MRI joint upper extremity" },
  { range: ["73721", "73723"], category: "Imaging", bucket: "B", note: "MRI joint lower extremity" },
  { range: ["74176", "74178"], category: "Imaging", bucket: "B", note: "CT abdomen/pelvis" },
  { range: ["76700", "76770"], category: "Imaging", bucket: "B", note: "Ultrasound abdomen" },
  { range: ["77065", "77067"], category: "Imaging", bucket: "B", note: "Mammography" },

  // ---- Specialty procedures (Cash-pay repriced) ----
  { range: ["29826", "29828"], category: "Procedures", bucket: "B", note: "Shoulder arthroscopy" },
  { range: ["29881", "29888"], category: "Procedures", bucket: "B", note: "Knee arthroscopy" },
  { range: ["43235", "43259"], category: "Procedures", bucket: "B", note: "Upper GI endoscopy" },
  { range: ["45378", "45385"], category: "Procedures", bucket: "B", note: "Colonoscopy" },
  { range: ["66984", "66984"], category: "Procedures", bucket: "B", note: "Cataract surgery" },
  { range: ["64483", "64484"], category: "Procedures", bucket: "B", note: "Epidural injection" },

  // ---- ER (Indemnity offset, then residual or stop-loss) ----
  { range: ["99281", "99285"], category: "ER", bucket: "C", note: "ER E/M services" },

  // ---- Inpatient (Stop-loss) ----
  { range: ["99221", "99239"], category: "Inpatient", bucket: "E", note: "Inpatient hospital E/M" },
  { range: ["99291", "99292"], category: "Inpatient", bucket: "E", note: "Critical care" },
];

// Default cash-pay price reference (national defaults, editable in Admin)
const DEFAULT_CASH_PRICES = {
  "70450": 350, "70470": 500, "70486": 350, "70491": 500, "70498": 500,
  "71045": 75, "71046": 95, "71047": 125, "71048": 175,
  "72100": 95, "72110": 145, "72141": 600, "72148": 600, "72156": 700,
  "73221": 550, "73222": 700, "73721": 550, "73722": 700, "73723": 800,
  "74176": 500, "74177": 650, "74178": 750,
  "76700": 200, "76705": 175, "76770": 250,
  "77065": 110, "77066": 130, "77067": 90,
  "29826": 4500, "29827": 5500, "29828": 5800,
  "29881": 4200, "29888": 6500,
  "43235": 950, "43239": 1100, "43249": 1400, "43259": 2200,
  "45378": 1200, "45380": 1400, "45385": 1600,
  "66984": 1800,
  "64483": 850, "64484": 950,
  "99281": 250, "99282": 400, "99283": 600, "99284": 900, "99285": 1400,
};

// Default repricing factors when no specific cash price exists
const DEFAULT_REPRICE_FACTORS = {
  "Imaging": 0.40,
  "Procedures": 0.50,
  "Lab": 0.30,
  "Specialist Consult": 0.55,
  "ASC Procedure": 0.45,
  "Outpatient Surgery": 0.50,
  "Other": 0.65,
};

// Indemnity benefits (editable in Admin)
const DEFAULT_INDEMNITY_BENEFITS = {
  "ER": { benefit: 1000, maxPerYear: 3 },
  "Hospital Admission": { benefit: 2500, maxPerYear: 2 },
  "Hospital Day": { benefit: 1000, maxPerYear: 10 },
  "Outpatient Surgery": { benefit: 1500, maxPerYear: 2 },
  "Imaging": { benefit: 250, maxPerYear: 4 },
  "Ambulance": { benefit: 500, maxPerYear: 2 },
};

// Predefined scenarios per spec
const SCENARIO_PRESETS = {
  conservative: {
    name: "Conservative",
    dpc_elimination_pct: 0.70,
    urgent_care_reduction_pct: 0.30,
    er_reduction_pct: 0.10,
    cashpay_discount_factor: 0.70,  // ratio of allowed remaining
    indemnity_enabled: true,
    attachment_point: 75000,
    stop_loss_pepm: 200,
    risk_margin: 1.40,
    description: "Underwriting-safe. Maximum funding buffer for the residual layer.",
  },
  expected: {
    name: "Expected",
    dpc_elimination_pct: 0.85,
    urgent_care_reduction_pct: 0.50,
    er_reduction_pct: 0.25,
    cashpay_discount_factor: 0.50,
    indemnity_enabled: true,
    attachment_point: 50000,
    stop_loss_pepm: 175,
    risk_margin: 1.25,
    description: "Balanced view. The base case for employer conversations.",
  },
  aggressive: {
    name: "Aggressive",
    dpc_elimination_pct: 0.95,
    urgent_care_reduction_pct: 0.70,
    er_reduction_pct: 0.40,
    cashpay_discount_factor: 0.40,
    indemnity_enabled: true,
    attachment_point: 50000,
    stop_loss_pepm: 150,
    risk_margin: 1.10,
    description: "Maximum efficiency. Demonstrates the full structural ceiling.",
  },
};

const OFFPLAN_MEMBERSHIP_PEPM = 195;
const TPA_PEPM = 40;

/* ---------------------------------------------------------------------
 *  PROVENANCE & VERSIONING (Data Dictionary v2)
 * ------------------------------------------------------------------- */

const INPUT_MODES = {
  FULL:     { id: "full",     label: "Full Claims",       confidence: "high",   description: "Member-level CPT-line claims" },
  PARTIAL:  { id: "partial",  label: "Partial Summary",   confidence: "medium", description: "Category-level totals" },
  MODELED:  { id: "modeled",  label: "Modeled Profile",   confidence: "low",    description: "Synthesized from benchmark" },
};

const CONFIDENCE_LEVELS = ["high", "medium", "low"];

const ASSUMPTION_SOURCES = {
  ACTUAL:    "actual",
  BENCHMARK: "benchmark",
  ADMIN:     "admin",
};

const DATA_SOURCES = ["claims_extract", "broker_report", "carrier_summary", "pbm_report", "self_reported", "benchmark", "admin"];

// Initial version labels — these become "v1.legacy" and live in versioned
// state from the moment the app loads. Any admin edit creates a new version.
const INITIAL_PRICING_VERSION = {
  id: "pv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  change_summary: "Initial baseline cash-pay reference prices (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};
const INITIAL_RULE_VERSION = {
  id: "rv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  change_summary: "Initial baseline CPT/POS/specialty bucket rules (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};
const INITIAL_INDEMNITY_VERSION = {
  id: "iv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  change_summary: "Initial baseline indemnity benefit schedule (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};
const INITIAL_BENCHMARK_VERSION = {
  id: "bv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  source_documentation: "SOA DPC Study (2024); Roundstone Indemnity & Stop-Loss Reference Tables.",
  change_summary: "Initial baseline benchmark profiles (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};

// Confidence color mapping for chips
const CONF_COLOR = {
  high:   { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-200" },
  medium: { bg: "bg-amber-100",   text: "text-amber-800",   border: "border-amber-200" },
  low:    { bg: "bg-rose-100",    text: "text-rose-800",    border: "border-rose-200" },
};

window.APP_CONSTANTS = {
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
};
})();
