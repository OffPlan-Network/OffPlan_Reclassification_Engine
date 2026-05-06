// Pre-built employer cases that load with one click. Each case
// exercises a different input mode and scenario combination so a viewer
// can see the full classification cascade without needing real claims.
//
// Loader kinds (interpreted by App.jsx → loadDemoCase):
//   - "synthetic_full":    use the synthetic generator, label as Mode 1
//   - "csv_partial":       fetch a partial-summary CSV from /data/
//   - "rows_partial":      inline partial-summary rows
//   - "modeled":           use the synthetic generator, Mode 3 / low confidence

export const DEMO_CASES = [
  {
    id: "DEMO_ABC",
    label: "ABC Manufacturing",
    tagline: "Self-funded · Full Claims (Mode 1)",
    blurb:
      "Mid-size Georgia manufacturer with TPA-extracted claim lines. Demonstrates the high-confidence path: every claim carries CPT-level detail and member-level stop-loss aggregation.",
    employer: {
      id: "DEMO_ABC",
      name: "ABC Manufacturing",
      industry: "Manufacturing",
      state: "GA",
      employee_count: 75,
      covered_lives: 162,
      current_funding_model: "self_funded",
      historical_claims_spend: 950000,
      current_total_healthcare_spend: 1187450,
      baseline_spend_type: "total_plan_cost",
      includes_stop_loss: true,
      includes_admin_fees: true,
      includes_broker_fees: true,
      baseline_confidence: "high",
      current_pepm: "",
      claims_period_start: "2025-01-01",
      claims_period_end: "2025-12-31",
      plan_type: "Self Funded",
    },
    loader: { kind: "synthetic_full", lives: 162, spend: 950000 },
    scenario: "expected",
    destination: "dashboard",
  },
  {
    id: "DEMO_XYZ",
    label: "XYZ Construction",
    tagline: "Level-funded · Partial Summary (Mode 2)",
    blurb:
      "Florida bonded contractor. Broker provided category totals only — no member-level claims. Engine decomposes summaries into representative claim lines and downgrades confidence accordingly.",
    employer: {
      id: "DEMO_XYZ",
      name: "XYZ Construction",
      industry: "Construction",
      state: "FL",
      employee_count: 42,
      covered_lives: 98,
      current_funding_model: "level_funded",
      historical_claims_spend: 540000,
      current_total_healthcare_spend: 612000,
      baseline_spend_type: "level_funded_contribution",
      includes_stop_loss: true,
      includes_admin_fees: true,
      includes_broker_fees: false,
      baseline_confidence: "medium",
      current_pepm: "",
      claims_period_start: "2025-01-01",
      claims_period_end: "2025-12-31",
      plan_type: "Level Funded",
    },
    loader: {
      kind: "rows_partial",
      rows: [
        { claims_category: "Primary Care",      annual_spend: 48000, covered_lives: 98, data_source: "broker_report",   confidence_level: "medium", period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Specialty Care",    annual_spend: 62000, covered_lives: 98, data_source: "broker_report",   confidence_level: "medium", period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Imaging",           annual_spend: 58000, covered_lives: 98, data_source: "broker_report",   confidence_level: "high",   period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Lab",               annual_spend: 18000, covered_lives: 98, data_source: "broker_report",   confidence_level: "medium", period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Procedures",        annual_spend: 95000, covered_lives: 98, data_source: "broker_report",   confidence_level: "medium", period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "ER",                annual_spend: 78000, covered_lives: 98, data_source: "broker_report",   confidence_level: "high",   period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Outpatient Surgery", annual_spend: 56000, covered_lives: 98, data_source: "broker_report",  confidence_level: "medium", period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Inpatient",         annual_spend: 85000, covered_lives: 98, data_source: "carrier_summary", confidence_level: "high",   period_start: "2025-01-01", period_end: "2025-12-31" },
        { claims_category: "Pharmacy",          annual_spend: 40000, covered_lives: 98, data_source: "pbm_report",      confidence_level: "high",   period_start: "2025-01-01", period_end: "2025-12-31" },
      ],
    },
    scenario: "conservative",
    destination: "dashboard",
  },
  {
    id: "DEMO_RHG",
    label: "Riverdale Hospitality Group",
    tagline: "Fully insured · Modeled (Mode 3)",
    blurb:
      "Texas hospitality group at quote stage with no claims access. Engine synthesizes a benchmark-scaled dataset. Output is illustrative, low confidence — for directional broker conversations only.",
    employer: {
      id: "DEMO_RHG",
      name: "Riverdale Hospitality Group",
      industry: "Hospitality",
      state: "TX",
      employee_count: 128,
      covered_lives: 205,
      current_funding_model: "fully_insured",
      historical_claims_spend: 1080000,
      current_total_healthcare_spend: 1340000,
      baseline_spend_type: "total_premium",
      includes_stop_loss: false,
      includes_admin_fees: false,
      includes_broker_fees: false,
      baseline_confidence: "low",
      current_pepm: "",
      claims_period_start: "2025-01-01",
      claims_period_end: "2025-12-31",
      plan_type: "Fully Insured",
    },
    loader: { kind: "modeled", lives: 205, spend: 1080000 },
    scenario: "aggressive",
    destination: "dashboard",
  },
];

// Sample CSV file references — used by the upload screens to offer a
// "Load sample file" shortcut without forcing the viewer to pick a file.
export const SAMPLE_CSV_FILES = {
  full:    { url: "./data/04a_template_1_full_claims_v21.csv",    label: "ABC Manufacturing — 6 sample claim lines" },
  partial: { url: "./data/04b_template_2_partial_summary_v21.csv", label: "ABC Manufacturing — 8 category totals" },
  profile: { url: "./data/04c_template_3_employer_profile.csv",    label: "Three demo employer profiles" },
};
