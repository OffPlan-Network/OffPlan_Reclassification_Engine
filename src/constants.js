export const DEFAULT_CPT_RULES = [
  { range: ["99201", "99205"], category: "Primary Care", bucket: "A", note: "New patient office visit" },
  { range: ["99211", "99215"], category: "Primary Care", bucket: "A", note: "Established patient office visit" },
  { range: ["99381", "99397"], category: "Primary Care", bucket: "A", note: "Preventive medicine" },
  { range: ["99401", "99404"], category: "Primary Care", bucket: "A", note: "Preventive counseling" },
  { range: ["99406", "99409"], category: "Primary Care", bucket: "A", note: "Behavioral counseling" },
  { range: ["99441", "99443"], category: "Primary Care", bucket: "A", note: "Telephone E/M" },
  { range: ["G0438", "G0439"], category: "Primary Care", bucket: "A", note: "Annual wellness visit" },
  { range: ["G0444", "G0444"], category: "Primary Care", bucket: "A", note: "Depression screening" },

  { range: ["80048", "80076"], category: "Lab", bucket: "A", note: "Basic metabolic panels" },
  { range: ["80061", "80061"], category: "Lab", bucket: "A", note: "Lipid panel" },
  { range: ["83036", "83037"], category: "Lab", bucket: "A", note: "Hemoglobin A1c" },
  { range: ["84443", "84443"], category: "Lab", bucket: "A", note: "TSH" },
  { range: ["85025", "85027"], category: "Lab", bucket: "A", note: "CBC" },
  { range: ["81000", "81003"], category: "Lab", bucket: "A", note: "Urinalysis" },
  { range: ["87086", "87088"], category: "Lab", bucket: "A", note: "Urine culture" },

  { range: ["70450", "70498"], category: "Imaging", bucket: "B", note: "CT head/neck" },
  { range: ["71045", "71048"], category: "Imaging", bucket: "B", note: "Chest X-ray" },
  { range: ["72100", "72120"], category: "Imaging", bucket: "B", note: "Spine X-ray" },
  { range: ["72141", "72158"], category: "Imaging", bucket: "B", note: "MRI spine" },
  { range: ["73221", "73223"], category: "Imaging", bucket: "B", note: "MRI joint upper extremity" },
  { range: ["73721", "73723"], category: "Imaging", bucket: "B", note: "MRI joint lower extremity" },
  { range: ["74176", "74178"], category: "Imaging", bucket: "B", note: "CT abdomen/pelvis" },
  { range: ["76700", "76770"], category: "Imaging", bucket: "B", note: "Ultrasound abdomen" },
  { range: ["77065", "77067"], category: "Imaging", bucket: "B", note: "Mammography" },

  { range: ["29826", "29828"], category: "Procedures", bucket: "B", note: "Shoulder arthroscopy" },
  { range: ["29881", "29888"], category: "Procedures", bucket: "B", note: "Knee arthroscopy" },
  { range: ["43235", "43259"], category: "Procedures", bucket: "B", note: "Upper GI endoscopy" },
  { range: ["45378", "45385"], category: "Procedures", bucket: "B", note: "Colonoscopy" },
  { range: ["66984", "66984"], category: "Procedures", bucket: "B", note: "Cataract surgery" },
  { range: ["64483", "64484"], category: "Procedures", bucket: "B", note: "Epidural injection" },

  { range: ["99281", "99285"], category: "ER", bucket: "C", note: "ER E/M services" },

  { range: ["99221", "99239"], category: "Inpatient", bucket: "E", note: "Inpatient hospital E/M" },
  { range: ["99291", "99292"], category: "Inpatient", bucket: "E", note: "Critical care" },
];

export const DEFAULT_CASH_PRICES = {
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

export const DEFAULT_REPRICE_FACTORS = {
  "Imaging": 0.40,
  "Procedures": 0.50,
  "Lab": 0.30,
  "Specialist Consult": 0.55,
  "ASC Procedure": 0.45,
  "Outpatient Surgery": 0.50,
  "Other": 0.65,
};

export const DEFAULT_INDEMNITY_BENEFITS = {
  "ER": { benefit: 1000, maxPerYear: 3 },
  "Hospital Admission": { benefit: 2500, maxPerYear: 2 },
  "Hospital Day": { benefit: 1000, maxPerYear: 10 },
  "Outpatient Surgery": { benefit: 1500, maxPerYear: 2 },
  "Imaging": { benefit: 250, maxPerYear: 4 },
  "Ambulance": { benefit: 500, maxPerYear: 2 },
};

// Stop-loss anchor is $100 PEPM (Section 2 working assumption).
// Conservative reflects Section 3 disclosure: "carriers will price initial coverage
// based on conservative assumptions until population experience validates the lower
// claims fund expectation, which may push initial stop-loss premiums above $100".
// Aggressive reflects post-experience pricing once a population has matured.
export const SCENARIO_PRESETS = {
  conservative: {
    name: "Conservative",
    dpc_elimination_pct: 0.70,
    urgent_care_reduction_pct: 0.50,
    er_reduction_pct: 0.10,
    cashpay_discount_factor: 0.70,
    indemnity_enabled: true,
    attachment_point: 75000,
    stop_loss_pepm: 130,
    risk_margin: 1.40,
    description: "Pre-experience underwriting. Stop-loss priced at conservative carrier markup over the $100 anchor.",
  },
  expected: {
    name: "Expected",
    dpc_elimination_pct: 0.85,
    urgent_care_reduction_pct: 0.65,
    er_reduction_pct: 0.25,
    cashpay_discount_factor: 0.50,
    indemnity_enabled: true,
    attachment_point: 50000,
    stop_loss_pepm: 100,
    risk_margin: 1.25,
    description: "Balanced view. Anchored to the $582.20 all-in stack and $200 PMPM claims fund working assumption.",
  },
  aggressive: {
    name: "Aggressive",
    dpc_elimination_pct: 0.95,
    urgent_care_reduction_pct: 0.80,
    er_reduction_pct: 0.40,
    cashpay_discount_factor: 0.40,
    indemnity_enabled: true,
    attachment_point: 50000,
    stop_loss_pepm: 85,
    risk_margin: 1.10,
    description: "Post-experience efficiency ceiling. Stop-loss reflects validated population experience.",
  },
};

// OffPlan stack components — anchors per "OffPlan Financial Model Assumptions
// Reference (Source of Truth)" May 2026, Section 2 (Complete Stack PEPM Build).
// Membership locked at $185 (down from prior $195 era). Other components are
// confirmed partner pricing or pre-launch working assumptions; flagged below.
export const OFFPLAN_MEMBERSHIP_PEPM = 185;       // Locked
export const TPA_PEPM = 40;                       // Yuzu confirmed
export const PBM_ADMIN_PEPM = 8;                  // Working assumption, finalize w/ Yuzu PBM RFP
export const FIRSTHEALTH_PEPM = 5.95;             // Yuzu rate card, confirmed
export const MEDWATCH_PEPM = 3.25;                // Yuzu rate card, confirmed
export const ACCIDENT_INDEMNITY_PEPM = 40;        // Working assumption, finalize w/ TownHealth or equivalent
// Sum of the above (excluding stop-loss + claims fund, which are scenario-dependent).
export const OFFPLAN_FIXED_OVERHEAD_PEPM =
  OFFPLAN_MEMBERSHIP_PEPM + TPA_PEPM + PBM_ADMIN_PEPM +
  FIRSTHEALTH_PEPM + MEDWATCH_PEPM + ACCIDENT_INDEMNITY_PEPM; // 282.20

// Event tier catalog for the v2 stochastic mode (Liquidity Spec v1.2 §4).
// Each tier defines:
//   - lambda_per_member_year: Poisson rate per covered member per year
//   - bucket: OffPlan classification bucket (A/B/C/D/E) — drives the
//     deterministic transformation applied to each generated event
//   - normalized_category: matches the engine's category strings so
//     indemnity offset rules (which key on category) work unchanged
//   - cost: distribution params. Either log-normal (mu, sigma) or
//     Pareto Type I (scale, shape). Mean cost is documented for sanity.
//
// Calibration anchors: industry-typical SMB self-funded PMPY mix (~$6,000
// in allowed claims, with the bulk in tiers 2/4/5/8 per published utilization
// data). Per-employer mix varies; the runtime drift indicator surfaces when
// simulated mean residual differs from deterministic residual by >10%.
//
// Defer per-spec for v2: complication clustering, chronic flare windows,
// negative-binomial frequency, and per-tier indemnity matching beyond
// what the existing rule set covers. README §11 documents the gap.
// Distribution params produce the documented mean_cost: for log-normal,
// mu = ln(mean) - sigma^2/2; for Pareto Type I, scale = mean * (shape-1)/shape.
// Mean cost is documented for human sanity-check; the runtime engine resolves
// from cost_mu/cost_sigma or pareto_scale/pareto_shape.
export const EVENT_TIER_CATALOG = [
  // T1 — Primary care. DPC absorbs entirely so the cost rarely materializes,
  // but we still generate events so the cascade's DPC-elimination math sees them.
  { tier: 1, label: 'Primary Care visit',         lambda_per_member_year: 3.5,  bucket: 'A', normalized_category: 'Primary Care',      cost_dist: 'lognormal', cost_mu: 5.22,  cost_sigma: 0.4, mean_cost: 200 },
  // T2 — Specialty consult.
  { tier: 2, label: 'Specialty consult',          lambda_per_member_year: 1.2,  bucket: 'B', normalized_category: 'Specialist Consult', cost_dist: 'lognormal', cost_mu: 5.42,  cost_sigma: 0.45, mean_cost: 250 },
  // T3 — Lab.
  { tier: 3, label: 'Lab',                        lambda_per_member_year: 2.0,  bucket: 'A', normalized_category: 'Lab',                cost_dist: 'lognormal', cost_mu: 4.30,  cost_sigma: 0.4, mean_cost: 80 },
  // T4 — Advanced imaging.
  { tier: 4, label: 'Imaging (advanced)',         lambda_per_member_year: 0.30, bucket: 'B', normalized_category: 'Imaging',            cost_dist: 'lognormal', cost_mu: 7.23,  cost_sigma: 0.55, mean_cost: 1600 },
  // T5 — ASC outpatient procedure.
  { tier: 5, label: 'ASC outpatient procedure',   lambda_per_member_year: 0.10, bucket: 'B', normalized_category: 'Outpatient Surgery', cost_dist: 'lognormal', cost_mu: 8.23,  cost_sigma: 0.7, mean_cost: 4800 },
  // T6 — ER, low acuity.
  { tier: 6, label: 'ER visit (low acuity)',      lambda_per_member_year: 0.14, bucket: 'C', normalized_category: 'ER',                 cost_dist: 'lognormal', cost_mu: 7.37,  cost_sigma: 0.5, mean_cost: 1800 },
  // T7 — ER, high acuity.
  { tier: 7, label: 'ER visit (high acuity)',     lambda_per_member_year: 0.05, bucket: 'C', normalized_category: 'ER',                 cost_dist: 'lognormal', cost_mu: 8.53,  cost_sigma: 0.7, mean_cost: 6500 },
  // T8 — Inpatient admission. Heavy tail. Pareto scale = mean*(shape-1)/shape.
  { tier: 8, label: 'Inpatient admission',        lambda_per_member_year: 0.030, bucket: 'E', normalized_category: 'Inpatient',         cost_dist: 'pareto',    pareto_scale: 8000,  pareto_shape: 1.4, mean_cost: 28000 },
  // T9 — Inpatient catastrophic. Rare, very heavy tail.
  { tier: 9, label: 'Inpatient catastrophic',     lambda_per_member_year: 0.003, bucket: 'E', normalized_category: 'Inpatient',         cost_dist: 'pareto',    pareto_scale: 41538, pareto_shape: 1.3, mean_cost: 180000 },
  // T10 — Specialty Rx (simplified to per-event sampling for MVP; the spec's
  // monthly-recurrence model is deferred).
  { tier: 10, label: 'Specialty Rx fill',         lambda_per_member_year: 0.30, bucket: 'D', normalized_category: 'Specialty Rx',       cost_dist: 'lognormal', cost_mu: 7.98,  cost_sigma: 0.6, mean_cost: 3500 },
  // T11 — Maternity / NICU. Simplified to single log-normal for MVP; bimodal
  // routine vs NICU treatment deferred.
  { tier: 11, label: 'Maternity / delivery',      lambda_per_member_year: 0.010, bucket: 'E', normalized_category: 'Inpatient',         cost_dist: 'lognormal', cost_mu: 9.30,  cost_sigma: 0.8, mean_cost: 15000 },
];

// Catastrophic-event tail overlay parameters for the stochastic liquidity
// layer. Each Monte Carlo run draws N ~ Poisson(lambda × covered_lives)
// extra catastrophic events on top of the resampled deterministic claims.
// Each event is Pareto-distributed (Type I, scale × U^(-1/shape)).
//
// These represent unobserved tail risk — population-level risk of
// inpatient catastrophic admissions / specialty Rx high-cost months that
// may not have manifested in this employer's specific claims year. Without
// the overlay, MRL is a lower bound (the simulator only models timing
// variance on observed claims).
//
// Calibration anchors (industry benchmarks):
//   - 0.5–1.5 % of covered population per year experiences a $50K+ allowed
//     event. lambda=0.005 represents the bottom of that range as the
//     "additional" risk on top of historical, so total expected
//     catastrophic events ≈ deterministic + 0.005 × lives per year.
//   - Pareto shape=1.5 is heavy-tailed but not pathological (E[X] finite).
//     scale=$50K matches typical specific stop-loss attachment.
//   - At shape=1.5, scale=50K: median $79K, mean $150K, P95 $369K, P99 $1.08M.
//
// Override per-call via simulateLiquidity({ ..., options: { tailOverlay: {...} }}).
export const CATASTROPHIC_TAIL_DEFAULTS = {
  enabled: true,
  lambda_per_member_year: 0.005,
  pareto_scale: 50000,
  pareto_shape: 1.5,
};

export const INPUT_MODES = {
  FULL:    { id: "full",    label: "Full Claims",     confidence: "high",   description: "Member-level CPT-line claims" },
  PARTIAL: { id: "partial", label: "Partial Summary", confidence: "medium", description: "Category-level totals" },
  MODELED: { id: "modeled", label: "Modeled Profile", confidence: "low",    description: "Synthesized from benchmark" },
};

export const CONFIDENCE_LEVELS = ["high", "medium", "low"];

export const ASSUMPTION_SOURCES = {
  ACTUAL: "actual",
  BENCHMARK: "benchmark",
  ADMIN: "admin",
};

export const DATA_SOURCES = ["claims_extract", "broker_report", "carrier_summary", "pbm_report", "self_reported", "benchmark", "admin"];

export const INITIAL_PRICING_VERSION = {
  id: "pv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  change_summary: "Initial baseline cash-pay reference prices (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};
export const INITIAL_RULE_VERSION = {
  id: "rv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  change_summary: "Initial baseline CPT/POS/specialty bucket rules (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};
export const INITIAL_INDEMNITY_VERSION = {
  id: "iv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  change_summary: "Initial baseline indemnity benefit schedule (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};
export const INITIAL_BENCHMARK_VERSION = {
  id: "bv_v1_legacy",
  version_label: "2026.05.01",
  effective_at: Date.now(),
  status: "active",
  source_documentation: "SOA DPC Study (2024); Roundstone Indemnity & Stop-Loss Reference Tables.",
  change_summary: "Initial baseline benchmark profiles (v1 → v2 migration).",
  created_by: "system",
  created_at: Date.now(),
};

export const CONF_COLOR = {
  high:   { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-200" },
  medium: { bg: "bg-amber-100",   text: "text-amber-800",   border: "border-amber-200" },
  low:    { bg: "bg-rose-100",    text: "text-rose-800",    border: "border-rose-200" },
};
