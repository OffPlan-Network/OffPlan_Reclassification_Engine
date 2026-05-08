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
    aggregate_stop_loss_enabled: true,
    aggregate_attachment_pct: 1.25,
    dpc_clinical_mitigation_pct: 0.20,
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
    aggregate_stop_loss_enabled: true,
    aggregate_attachment_pct: 1.25,
    dpc_clinical_mitigation_pct: 0.30,
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
    aggregate_stop_loss_enabled: true,
    aggregate_attachment_pct: 1.20,
    dpc_clinical_mitigation_pct: 0.45,
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
//
// Complication parameters per Spec v1.2 §4.1:
//   complication_probability — chance an event triggers a follow-on event
//     within the lag window, on the same member, of the same tier
//   complication_lag_days_median + complication_lag_days_sigma — log-normal
//     lag from index event to follow-on (sigma is the lognormal σ; median
//     is converted to mu via ln(median))
// Per-spec defaults: T5 0.04, T6 0.06, T7 0.10, T8 0.18, T9 0.25; T1-T4
// have no clinical model for clustering and are left at 0.
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
  { tier: 5, label: 'ASC outpatient procedure',   lambda_per_member_year: 0.10, bucket: 'B', normalized_category: 'Outpatient Surgery', cost_dist: 'lognormal', cost_mu: 8.23,  cost_sigma: 0.7, mean_cost: 4800,
    complication_probability: 0.04, complication_lag_days_median: 21, complication_lag_days_sigma: 0.5 },
  // T6 — ER, low acuity.
  { tier: 6, label: 'ER visit (low acuity)',      lambda_per_member_year: 0.14, bucket: 'C', normalized_category: 'ER',                 cost_dist: 'lognormal', cost_mu: 7.37,  cost_sigma: 0.5, mean_cost: 1800,
    complication_probability: 0.06, complication_lag_days_median: 14, complication_lag_days_sigma: 0.6 },
  // T7 — ER, high acuity.
  { tier: 7, label: 'ER visit (high acuity)',     lambda_per_member_year: 0.05, bucket: 'C', normalized_category: 'ER',                 cost_dist: 'lognormal', cost_mu: 8.53,  cost_sigma: 0.7, mean_cost: 6500,
    complication_probability: 0.10, complication_lag_days_median: 10, complication_lag_days_sigma: 0.7 },
  // T8 — Inpatient admission. Heavy tail. Pareto scale = mean*(shape-1)/shape.
  // freq_dist='negbin' with freq_k=2 produces variance ≈ mean × 1.5 — modest
  // over-dispersion that matches inpatient utilization patterns in
  // chronic-prevalent populations (per Spec v1.2 §4 — "Negative Binomial w/
  // chronic"). Lower freq_k = heavier tail in event count distribution.
  { tier: 8, label: 'Inpatient admission',        lambda_per_member_year: 0.030, bucket: 'E', normalized_category: 'Inpatient',         cost_dist: 'pareto',    pareto_scale: 8000,  pareto_shape: 1.4, mean_cost: 28000, freq_dist: 'negbin', freq_k: 2.0,
    complication_probability: 0.18, complication_lag_days_median: 21, complication_lag_days_sigma: 0.8 },
  // T9 — Inpatient catastrophic. Rare, very heavy tail.
  { tier: 9, label: 'Inpatient catastrophic',     lambda_per_member_year: 0.003, bucket: 'E', normalized_category: 'Inpatient',         cost_dist: 'pareto',    pareto_scale: 41538, pareto_shape: 1.3, mean_cost: 180000,
    complication_probability: 0.25, complication_lag_days_median: 30, complication_lag_days_sigma: 0.9 },
  // T10 — Specialty Rx (monthly-recurrence regimen per Liquidity Spec v1.2 §4).
  // Real specialty Rx is not independent per-event sampling — chronic-disease
  // drug regimens (Humira, Cosentyx, Tysabri, Trikafta, oral oncology) fill
  // the same prescription monthly on the same member for the duration of
  // their treatment. The simulator handles this via the regimen_mode branch
  // in src/engine/stochastic.js → simulateOnceFromCatalog: it pre-samples
  // `regimen_member_fraction × lives` members from the chronic pool at run
  // start, then generates `fills_per_member_year` monthly events for each
  // (cost per fill sampled independently from the log-normal so PBM /
  // dispensing variance is captured).
  //
  // Expected total T10 events: 0.03 × lives × 12 = 0.36 × lives, matching
  // the prior λ × chronic_uplift × lives = 0.384 × lives but concentrated
  // on ~3% of the population for realistic cost clustering. Per-member
  // annual T10 spend at mean cost: 12 × $3500 = $42K, in line with
  // industry biologic/specialty-Rx PMPY anchors.
  //
  // T10 does NOT use the chronic_pool / non-chronic_pool split — the
  // regimen-mode branch supersedes the standard Poisson sampling. T10
  // is also removed from CHRONIC_TIER_UPLIFT for the same reason.
  { tier: 10, label: 'Specialty Rx fill',         lambda_per_member_year: 0.30, bucket: 'D', normalized_category: 'Specialty Rx',       cost_dist: 'lognormal', cost_mu: 7.98,  cost_sigma: 0.6, mean_cost: 3500,
    regimen_mode: 'monthly_recurrence', regimen_member_fraction: 0.03, fills_per_member_year: 12 },
  // T11 — Maternity / routine delivery. Per Liquidity Spec v1.2 §4 bimodal
  // split. Routine births (vaginal or scheduled C-section without NICU) are
  // plannable care that can be priced at contracted/transparent rates,
  // similar to outpatient specialty surgery — modeled as Bucket B (cash-pay
  // repriced via scenario.cashpay_discount_factor, 70%/50%/40% across
  // presets). Reflects the OffPlan thesis that maternity follows the same
  // pricing-transparency mechanism as ASC procedures and specialty consults
  // when uncomplicated.
  //
  // Cost calibration: log-normal mean $12K with sigma=0.4 (tight). CDC
  // working-age employer-pop birth rate ≈ 1% of total covered lives per
  // year; routine/complicated split is roughly 80/20 per NCHS NICU data.
  // λ=0.008 captures the 80% routine share. Triggers Hospital Admission
  // indemnity offset ($2.5K/event) just like the catastrophic path.
  { tier: 11, label: 'Maternity / routine delivery',  lambda_per_member_year: 0.008, bucket: 'B', normalized_category: 'Inpatient', cost_dist: 'lognormal', cost_mu: 9.31,   cost_sigma: 0.4, mean_cost: 12000 },
  // T12 — Maternity / NICU complications. The other half of the bimodal
  // split: premature births, NICU stays, emergency C-sections with
  // complications. Cannot be cash-pay repriced — flows through Bucket E
  // (catastrophic) with member-aggregate stop-loss attachment. The σ=0.7
  // log-normal captures the heavy NICU tail ($40K-$300K typical range,
  // mean $80K reflecting that NICU stays average ~$3K/day for ~14 days
  // plus delivery + complication-driven extension). λ=0.002 captures the
  // 20% complicated share of total maternity events.
  { tier: 12, label: 'Maternity / NICU complications', lambda_per_member_year: 0.002, bucket: 'E', normalized_category: 'Inpatient', cost_dist: 'lognormal', cost_mu: 11.045, cost_sigma: 0.7, mean_cost: 80000 },
];

// Chronic-clustering parameters for the tier-generated stochastic mode.
//
// Spec v1.2 §4.1 names "chronic flag" as a clustering driver: a fraction of
// the population carries one or more chronic conditions, and those members
// generate more events at certain tiers (specialist follow-ups, advanced
// imaging surveillance, ASC interventions, ER flares, inpatient admissions,
// specialty Rx). At simulation time we draw which member IDs are chronic
// once per run from CHRONIC_PREVALENCE, then sample per-tier events from a
// chronic pool (rate λ × effective_uplift) and a non-chronic pool (rate λ)
// separately. Repeated draws on the smaller chronic pool produce the
// clustering effect: the same chronic members rack up multiple events.
//
// CHRONIC_PREVALENCE = 0.28 — anchored to CDC working-age (18–64) chronic-
// condition prevalence (~28% with at least one chronic condition managed
// long-term; the all-adult rate is ~40% but employer populations skew
// younger). Per-employer mix can vary substantially.
export const CHRONIC_PREVALENCE = 0.28;

// CHRONIC_TIER_UPLIFT — multiplier on a tier's lambda for chronic members.
// Tiers omitted here default to 1.0 (no uplift). The DPC clinical mitigation
// factor (per scenario) shrinks the *additional* uplift toward 1.0:
//   effective_uplift = 1 + (raw_uplift − 1) × (1 − dpc_clinical_mitigation_pct)
// So at the Expected scenario (mitigation=0.30), T8's raw 1.7× becomes 1.49×.
//
// Anchors: T2/T4/T5 reflect chronic-condition specialist + procedure
// utilization (musculoskeletal, cardiology, endocrine). T6/T7 reflect
// uncontrolled flares routing through ER. T8 reflects exacerbation-driven
// admissions. T10 reflects autoimmune/oncology maintenance regimens that
// concentrate in chronic-flagged members. T1 (DPC-eliminated), T3 (lab,
// neutral), T9 (catastrophic, orthogonal), T11 (maternity, orthogonal) are
// not uplifted.
export const CHRONIC_TIER_UPLIFT = {
  2: 1.6,   // Specialty consult
  4: 1.4,   // Imaging (advanced)
  5: 1.3,   // ASC outpatient procedure
  6: 1.4,   // ER (low acuity) — uncontrolled flares
  7: 1.3,   // ER (high acuity)
  8: 1.7,   // Inpatient admission — chronic exacerbations
  // T10 (Specialty Rx) is NOT uplifted here — it uses the monthly-recurrence
  // regimen model in EVENT_TIER_CATALOG instead, which concentrates fills
  // on a 3% regimen-member subset of the chronic pool. The regimen branch
  // in stochastic.js → simulateOnceFromCatalog supersedes the chronic-uplift
  // pathway for T10.
};

// Chronic condition catalog — documentation-only stub today, hydrating
// surface tomorrow.
//
// Chronicity itself is not what drives MRL; *expensive* chronicity is.
// Hypertension on a generic ACE inhibitor is cheap. Psoriatic arthritis
// on Cosentyx is $60K/yr. Crohn's on Remicade plus periodic admissions
// is $80K+/yr. Hemophilia with factor concentrates is $200K-$500K/yr.
// The dictionary distinguishes these so the simulator can ultimately
// weight chronic uplift by per-condition cost band.
//
// Today: synthetic claim records do not carry ICD-10 codes, so the
// catalog cannot match against incoming claims. estimateChronicPrevalence
// in src/engine/calibration.js uses a utilization-pattern heuristic
// (multi-criterion, any 2 of 3) instead. The structure below is the
// hydrating surface for when real claims data with diagnosis codes
// arrives.
//
// Production wiring (TODO when ICD-10 codes land on claim records):
//   1. Add icd10ToCondition(code) lookup in calibration.js using icd10_prefixes
//   2. Implement identifyExpensiveChronicMembers() to match per-claim ICD-10
//      against this catalog and produce per-member condition profiles
//   3. Surface "expensive chronic share" alongside overall prevalence
//      in the chronic_clustering result block
//   4. Optional: per-condition uplift weights replacing the flat
//      CHRONIC_TIER_UPLIFT — high-cost autoimmune drives T10 specialty
//      Rx differently than HTN drives T2 specialty consults
//
// Cost-band methodology:
//   low     — generics + routine monitoring; sub-$2K incremental annual cost
//   medium  — brand Rx + occasional specialist + admit risk; $2K-$15K/yr
//   high    — biologics, dialysis, immunosuppressants, oncology; $25K+/yr
//
// References for icd10_prefix mappings: CMS HCC categories, CMS Chronic
// Conditions Warehouse (CCW) flags. Coverage is illustrative, not
// exhaustive — production should expand from CMS HCC v24 list.
export const CHRONIC_CONDITION_CATALOG = [
  // ----- Low-cost chronic (generics, routine monitoring) -----
  { id: 'htn',           name: 'Hypertension',                      icd10_prefixes: ['I10','I11','I12','I13','I15'], cost_band: 'low',    expensive: false, notes: 'ACE/ARB/CCB/diuretic generics; quarterly visits' },
  { id: 'dm2',           name: 'Type 2 diabetes',                   icd10_prefixes: ['E11'],                          cost_band: 'low',    expensive: false, notes: 'Metformin/SU generics; A1c monitoring. Insulin-dependent shifts to medium' },
  { id: 'hypothyroid',   name: 'Hypothyroidism',                    icd10_prefixes: ['E03'],                          cost_band: 'low',    expensive: false, notes: 'Generic levothyroxine; annual TSH' },
  { id: 'hyperlipidemia',name: 'Hyperlipidemia',                    icd10_prefixes: ['E78'],                          cost_band: 'low',    expensive: false, notes: 'Statin generics' },
  { id: 'gerd',          name: 'GERD',                              icd10_prefixes: ['K21'],                          cost_band: 'low',    expensive: false, notes: 'PPI generics' },
  { id: 'asthma',        name: 'Asthma (mild persistent)',          icd10_prefixes: ['J45'],                          cost_band: 'low',    expensive: false, notes: 'Generic ICS; brand inhalers shift to medium' },
  { id: 'depression',    name: 'Depression',                        icd10_prefixes: ['F32','F33'],                    cost_band: 'low',    expensive: false, notes: 'Generic SSRIs; therapy may shift cost' },
  { id: 'anxiety',       name: 'Anxiety',                           icd10_prefixes: ['F40','F41'],                    cost_band: 'low',    expensive: false, notes: 'Generic SSRIs/benzos' },
  { id: 'lbp',           name: 'Low back pain (chronic)',           icd10_prefixes: ['M54'],                          cost_band: 'low',    expensive: false, notes: 'PT/NSAIDs typical; surgery shifts to high one-time' },
  { id: 'osteoarthritis',name: 'Osteoarthritis',                    icd10_prefixes: ['M15','M16','M17','M18','M19'],  cost_band: 'low',    expensive: false, notes: 'NSAIDs/PT; joint replacement shifts to high one-time' },

  // ----- Medium-cost chronic (brand Rx, frequent specialist, admit risk) -----
  { id: 'copd',          name: 'COPD',                              icd10_prefixes: ['J44'],                          cost_band: 'medium', expensive: false, notes: 'Brand inhalers + ER risk for exacerbations' },
  { id: 'chf',           name: 'Congestive heart failure',          icd10_prefixes: ['I50'],                          cost_band: 'medium', expensive: false, notes: 'Multiple Rx + admit risk; advanced CHF (LVADs, transplant) high' },
  { id: 'cad',           name: 'Coronary artery disease',           icd10_prefixes: ['I20','I25'],                    cost_band: 'medium', expensive: false, notes: 'Antiplatelet/statin; revascularization episodes high one-time' },
  { id: 'osa',           name: 'Sleep apnea',                       icd10_prefixes: ['G47.33'],                       cost_band: 'medium', expensive: false, notes: 'CPAP + sleep studies' },
  { id: 'migraine',      name: 'Chronic migraine',                  icd10_prefixes: ['G43'],                          cost_band: 'medium', expensive: false, notes: 'CGRP antagonists (Aimovig/Emgality) shift to high' },
  { id: 'dm1',           name: 'Type 1 diabetes',                   icd10_prefixes: ['E10'],                          cost_band: 'medium', expensive: false, notes: 'Insulin + CGM/pump; pump+CGM combo can shift to high' },
  { id: 'epilepsy',      name: 'Epilepsy',                          icd10_prefixes: ['G40'],                          cost_band: 'medium', expensive: false, notes: 'Brand AEDs + monitoring' },

  // ----- High-cost chronic (biologics, specialty Rx, dialysis, oncology) -----
  { id: 'ra',            name: 'Rheumatoid arthritis',              icd10_prefixes: ['M05','M06'],                    cost_band: 'high',   expensive: true,  notes: 'Biologics (Humira/Enbrel/Rinvoq) $50K-$70K/yr' },
  { id: 'psoriatic',     name: 'Psoriatic arthritis / psoriasis',   icd10_prefixes: ['L40'],                          cost_band: 'high',   expensive: true,  notes: 'Biologics (Cosentyx/Stelara/Skyrizi) $60K-$80K/yr' },
  { id: 'crohns',        name: "Crohn's disease",                   icd10_prefixes: ['K50'],                          cost_band: 'high',   expensive: true,  notes: 'Biologics + admit risk $60K-$100K/yr' },
  { id: 'uc',            name: 'Ulcerative colitis',                icd10_prefixes: ['K51'],                          cost_band: 'high',   expensive: true,  notes: 'Biologics $60K-$90K/yr' },
  { id: 'ms',            name: 'Multiple sclerosis',                icd10_prefixes: ['G35'],                          cost_band: 'high',   expensive: true,  notes: 'DMTs (Tysabri/Ocrevus/Kesimpta) $75K-$100K/yr' },
  { id: 'lupus',         name: 'Systemic lupus',                    icd10_prefixes: ['M32'],                          cost_band: 'high',   expensive: true,  notes: 'Biologics (Benlysta) + monitoring $40K-$70K/yr' },
  { id: 'cancer_active', name: 'Active oncology treatment',         icd10_prefixes: ['C'],                            cost_band: 'high',   expensive: true,  notes: 'Wide range $30K-$500K+/yr depending on regimen + immunotherapy' },
  { id: 'esrd',          name: 'ESRD / dialysis',                   icd10_prefixes: ['N18.6'],                        cost_band: 'high',   expensive: true,  notes: 'Dialysis $90K+/yr; Medicare-eligible after 30 mo for most' },
  { id: 'cf',            name: 'Cystic fibrosis',                   icd10_prefixes: ['E84'],                          cost_band: 'high',   expensive: true,  notes: 'Trikafta $300K/yr' },
  { id: 'hiv',           name: 'HIV',                               icd10_prefixes: ['B20'],                          cost_band: 'high',   expensive: true,  notes: 'ART regimens $30K-$50K/yr' },
  { id: 'hemophilia',    name: 'Hemophilia',                        icd10_prefixes: ['D66','D67'],                    cost_band: 'high',   expensive: true,  notes: 'Factor concentrates $200K-$500K+/yr; gene therapy seven-figure one-time episode' },
  { id: 'transplant',    name: 'Solid organ transplant maintenance',icd10_prefixes: ['Z94'],                          cost_band: 'high',   expensive: true,  notes: 'Lifetime immunosuppressants + monitoring; episode itself catastrophic' },
  { id: 'hep_c',         name: 'Hepatitis C (active treatment)',    icd10_prefixes: ['B17.1','B18.2'],                cost_band: 'high',   expensive: true,  notes: 'Mavyret/Epclusa $25K-$40K curative episode (one-time)' },
  { id: 'sickle_cell',   name: 'Sickle cell disease',               icd10_prefixes: ['D57'],                          cost_band: 'high',   expensive: true,  notes: 'Crizanlizumab/Voxelotor + admit risk; gene therapy $2M+ episodic' },
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

// Payment schedule for stop-loss-eligible claims. Real-world hospital
// billing for catastrophic admissions has adjudication delays (claims
// review, coding audits, network reprice) plus invoice terms (typically
// net-30 / net-60), so the employer's cash outflow on a $200K admission
// does not hit fully in the month of service. Default: 1/3 in the
// month of service, 1/3 the next month, 1/3 the third month.
//
// Applied only to claims/events with stop_loss_amount > 0 (the threshold
// signal that a claim is large enough to go through traditional hospital
// adjudication). Smaller claims paid via the cash-pay network settle
// same-month. The stop-loss carrier reimbursement schedule is unchanged
// — still arrives at month + lagMonths from the original claim incident.
//
// Override per-call via simulateLiquidity({ options: { stopLossPaymentSchedule: [1] } }) to disable
// the spread (single-month outflow), useful for sensitivity testing.
export const STOP_LOSS_PAYMENT_SCHEDULE = [1 / 3, 1 / 3, 1 / 3];

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
