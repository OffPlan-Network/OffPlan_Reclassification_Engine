# OffPlan Claims Reclassification Engine — Reference Implementation

An interactive, single-page React demo of the **OffPlan Claims Reclassification Engine**: a five-stage classification cascade that takes an employer's historical healthcare claims, reclassifies every dollar under the OffPlan architecture (DPC eliminated → cash-pay repriced → indemnity offset → stop-loss shifted → residual funded), and surfaces the resulting employer-cost story.

This codebase is the **deterministic classification layer** of the engine described in `docs/01_OffPlan_Engine_Master_Specification_v33.docx` and `docs/06_OffPlan_Engine_Liquidity_Capital_Modeling_Spec_v12.docx`. The stochastic capital layer (Min Required Liquidity, CER, P50–P99 bands) is **not** in this build — see "What this build does not compute" below.

The companion docs in `docs/` are the authoritative spec; this README is the operator-facing summary of how the running app implements them.

---

## 1. Quick start

```bash
npm install
npm run dev          # Vite dev server with HMR
npm run build        # production build → dist/
npm run preview      # serve the built dist/ locally
npm run gen-demo     # regenerate frozen demo JSONs in public/data/
```

There are no tests, no linter, and no typechecker configured. The app is purely client-side — no backend, no API. Persistence is `localStorage` (with an in-memory fallback for sandboxed contexts), namespaced under `offplan_engine:`.

Deployment: Vercel, via its GitHub integration — Vercel watches `master`/`main` and ships every push. No GitHub Actions workflow involved.

### When to re-run `npm run gen-demo`

After changing `src/engine/synthetic.js` or `scripts/generate-demo-claims.mjs`. Otherwise the deterministic Mode 1 demos (ABC Manufacturing, Riverdale Hospitality) drift from whatever the synthetic generator currently emits. The script uses a seeded mulberry32 PRNG so output is byte-stable across machines.

---

## 2. The OffPlan thesis

Most healthcare doesn't require insurance. Today every funding model — fully insured, level-funded, self-funded — pre-funds *all* expected spend as if every dollar were a volatile, claims-style risk. That overfunds predictable care (primary care, chronic management, routine diagnostics) and misuses insurance on services that don't need risk pooling.

OffPlan splits historical spend into five economic categories with different funding mechanics:

| If the dollar is…              | …it should be funded as | …because                                              |
|---                             |---                      |---                                                    |
| Routine / chronic / preventive | DPC membership          | Predictable; bulk membership eliminates the claim     |
| Specialty / imaging / ASC      | Cash-pay at market rate | Transparent pricing exists; insurance markup is dead-weight |
| Mid-acuity events (ER, admit)  | Structured indemnity    | Fixed cash benefit caps employer exposure on triggering events |
| Catastrophic                   | Specific stop-loss      | True insurable risk; this is what insurance is for    |
| Whatever's left                | Employer residual fund  | Genuinely requires claims-style funding under OffPlan |

The engine's job is to take a real claims file (or a category-level summary, or a modeled profile) and tell the CFO three things:

1. **What disappears** under OffPlan (DPC eliminated, repricing savings).
2. **What gets cheaper** (indemnity offset, ER reduction, stop-loss shift).
3. **What's left to fund** (the residual claims fund, expressed as both annual dollars and PEPM).

Then it compares the **OffPlan total stack** against the employer's **current total healthcare spend** to produce a defensible savings number.

---

## 3. The five-bucket model

Defined in `src/engine/classify.js` and `src/constants.js → DEFAULT_CPT_RULES`.

| Bucket | Name              | Treatment                                    | Driver                                                      |
|---     |---                |---                                           |---                                                          |
| **A**  | DPC Eliminated    | Modeled cost = `allowed × (1 − dpc_pct)`     | Membership-based primary, chronic, prevention               |
| **B**  | Cash-Pay Repriced | Modeled cost = cash-table price OR `allowed × factor` | Specialty, imaging, lab, ASC, urgent care          |
| **C**  | Indemnity Offset  | Per-event cash benefit reduces residual      | ER, hospital admit, hospital day, outpatient surgery        |
| **D**  | Residual Fund     | Stays as employer-funded residual            | Specialty Rx, "Other"                                       |
| **E**  | Catastrophic      | Above attachment shifts to stop-loss carrier | Inpatient, late-stage oncology, NICU                        |

Bucket assignment precedence (in `normalizeAndClassify`):

```
DRG or POS=Inpatient  →  E
POS=ER                →  C
POS=Urgent            →  B
POS=ASC + CPT match   →  bucket from CPT rule (else B)
CPT range match       →  bucket from CPT rule
  └ if Primary Care + non-PCP specialty → B (Specialist Consult)
claim_type ~ Rx/pharmacy → D
otherwise             →  D (low confidence)
```

---

## 4. The mandatory cascade

Order is **load-bearing**. Reordering changes results. Skipping member-level aggregation in stop-loss systematically understates the catastrophic shift. Implementation in `src/engine/calculate.js:6-113`.

```
1. DPC elimination
2. Cash-pay repricing
3. Indemnity offset
4. Stop-loss split (member-level aggregation)
5. Residual = whatever's left
```

### 4.1 DPC elimination (Bucket A)

```
modeled_cost = allowed × (1 − scenario.dpc_elimination_pct)
dpc_eliminated = Σ allowed × dpc_elimination_pct   (over all Bucket A claims)
```

Under the **Expected** preset (`dpc_elimination_pct = 0.85`), 85 % of every Bucket A dollar disappears.

### 4.2 Cash-pay repricing (Bucket B)

```
if cash_price_table[cpt] exists:
    modeled_cost = min(cash_price, allowed)
else:
    modeled_cost = allowed × (repriceFactors[category] ?? scenario.cashpay_discount_factor)

if category == "Urgent Care":
    modeled_cost *= (1 − scenario.urgent_care_reduction_pct)
```

Default repricing factors (`DEFAULT_REPRICE_FACTORS`): Imaging 0.40, Lab 0.30, Specialist Consult 0.55, Procedures 0.50, ASC Procedure 0.45, Outpatient Surgery 0.50, Other 0.65. These say "the OffPlan cash-pay network charges 40–65 % of allowed for the same service."

### 4.3 ER reduction (Bucket C)

```
modeled_cost = allowed × (1 − scenario.er_reduction_pct)
er_reduction_savings = Σ allowed × er_reduction_pct   (over all Bucket C claims)
```

The reduction reflects the share of low-acuity ER visits that DPC + telehealth + indemnity-funded urgent care intercept before they hit the ER.

### 4.4 Indemnity offset

Walks claims in **modeled-cost-descending order**, applying per-member, per-event-type benefit caps from `indemnityBenefits`. Default schedule (`DEFAULT_INDEMNITY_BENEFITS`):

| Event type         | Benefit | Max/year |
|---                 |---      |---       |
| ER                 | $1,000  | 3        |
| Hospital Admission | $2,500  | 2        |
| Hospital Day       | $1,000  | 10       |
| Outpatient Surgery | $1,500  | 2        |
| Imaging            | $250    | 4        |
| Ambulance          | $500    | 2        |

```
net_after_indemnity = max(modeled_cost − indemnity_benefit, 0)
```

Eligible categories include ER (Bucket C), Inpatient, Imaging > $200 modeled, Outpatient Surgery, and Procedures > $1,000 modeled.

### 4.5 Stop-loss split — member-level aggregation

This is the step that's most often implemented wrong. Stop-loss must aggregate at the **member level first**, then drain the overage from that member's largest claims. Computing stop-loss line-by-line systematically understates the catastrophic shift.

```
for each member:
    member_total = Σ modeled_cost for that member
    if member_total > scenario.attachment_point:
        overage = member_total − scenario.attachment_point
        # drain `overage` from this member's claims, biggest first
        for each claim of this member, descending modeled_cost:
            take = min(remaining_overage, claim.modeled_cost)
            claim.stop_loss_amount = take
            claim.modeled_cost   −= take
```

Default `attachment_point` = $50K (Expected scenario).

### 4.6 Residual

```
residual_amount = whatever's left on each claim
residual_fund   = Σ residual_amount
residual_pepm   = residual_fund / covered_lives / 12
```

`historical_claims = Σ allowed_amount` over the active (non-excluded) claims is the **modeling input** — not the savings comparison baseline. See §5.

### 4.7 Conservation invariant

For any active claim:

```
allowed_amount  =  dpc_eliminated_share
                 + repricing_savings
                 + er_reduction_savings
                 + indemnity_offset
                 + stop_loss_amount
                 + residual_amount
```

Across the whole dataset, the six aggregate components sum exactly to `historical_claims`. This is the integrity check; any drift is a calculation bug.

---

## 5. Two baselines — never conflate them

The single most common analytical error is using **historical claims spend** as the savings comparison baseline. It's not. Doing so understates OffPlan savings by 13–40 % depending on funding model, because the OffPlan stack covers components (TPA, network, broker, stop-loss premium, admin) that are bundled into the current total cost but aren't in the claims-only number.

| Number                            | Used for                          | Where it comes from |
|---                                |---                                |---                  |
| **Historical Claims Spend**       | Reclassification modeling input   | Σ `allowed_amount` from the claims file (or category totals, or modeled output) |
| **Current Total Healthcare Spend**| Savings comparison baseline       | Setup screen, plan-structure-specific:                       |
|                                   |                                   | • Fully insured: total annual premium (employer + employee)  |
|                                   |                                   | • Level-funded: total contribution (claims fund + stop-loss + admin + carrier fees) |
|                                   |                                   | • Self-funded: claims paid + stop-loss + TPA + network + PBM/admin + broker |

The dashboard and report both **refuse to compute savings** until `current_total_healthcare_spend` is non-zero. PDF export is blocked on the same condition. This is a deliberate guardrail — see `DashboardScreen.jsx:208-215` and `ReportScreen.jsx`.

---

## 6. The OffPlan stack (what the employer pays under OffPlan)

```
Total OffPlan PEPM =
      OFFPLAN_MEMBERSHIP_PEPM           ($195 default — `src/constants.js`)
    + recommended_funding_pepm          (residual_pepm × scenario.risk_margin)†
    + scenario.stop_loss_pepm           ($80 / $100 / $120 by preset)
    + TPA_PEPM                          ($40 default)

Annual: Total OffPlan PEPM × covered_lives × 12

Net Annual Savings = current_total_healthcare_spend − OffPlan Annual
```

† **The `risk_margin × residual_pepm` step is the deprecated v3.0/v3.1 funding construct.** Master Spec v3.3 §6.6 retires it in favor of stochastic Min Required Liquidity. The dashboard labels it "deprecated intermediate placeholder" and shows Min Required Liquidity as `—` until the stochastic layer ships. Treat the resulting funding number as a **conservative, deterministic placeholder** — adequate for an order-of-magnitude employer conversation, not for an MGU underwriting submission.

---

## 7. Three input modes

| Mode    | Data shape                          | Confidence | Typical employer                     |
|---      |---                                  |---         |---                                   |
| **Full** (Mode 1)    | Member-level CPT-line claims (CSV or JSON) | High   | Self-funded with TPA access |
| **Partial** (Mode 2) | Category-level totals only          | Medium     | Level-funded with broker reports     |
| **Modeled** (Mode 3) | Headcount, industry, total spend    | Low (illustrative) | Fully insured, no claims access |

Mode 2 fans category totals into representative claim lines via `decomposePartialSummary()` using the same `SYNTHETIC_DISTRIBUTION` table the modeled generator uses. Mode 3 invokes `generateSyntheticClaims()` (hard-capped at 20,000 lines to protect the browser) to build a benchmark-scaled dataset from covered lives + annual spend.

Each ingested claim is stamped at ingestion with eight provenance fields: `input_mode`, `data_source`, `confidence_level`, `assumption_source`, `pricing_version_id`, `rule_version_id`, `indemnity_version_id`, `benchmark_version_id` — see `App.jsx → ingestClaims()`. These propagate through every dashboard, KPI, and PDF.

---

## 8. Worked example — ABC Manufacturing (Mode 1)

Inputs (`src/demo-cases.js`):

```
covered_lives                  = 162
employee_count                 = 75
historical_claims_spend        = $950,000
current_total_healthcare_spend = $1,187,450  (self-funded total plan cost)
```

Frozen demo JSON (`public/data/demo_abc_manufacturing_claims.json`) contains 1,758 deterministic claim lines totaling $983,370 — 3.5 % above the $950K nominal target (drift introduced when the synthetic distribution was rebalanced to better match real SMB benchmarks). Because the demo file is seeded, the math is reproducible across runs.

### 8.1 Bucket distribution (after `normalizeAndClassify`)

|        | Claims | Σ allowed | Share of historical |
|---     |---:    |---:       |---:                 |
| **A** Primary care, lab, prevention | 1,067 | $114,443 | 11.6 % |
| **B** Specialty, imaging, ASC, urgent care | 552 | $415,450 | 42.2 % |
| **C** ER | 42 | $75,623 | 7.7 % |
| **D** Specialty Rx + Other | 90 | $160,961 | 16.4 % |
| **E** Inpatient (catastrophic) | 7 | $216,893 | 22.1 % |
| **Total** | **1,758** | **$983,370** | 100.0 % |

### 8.2 Cascade output, all three presets

Each row below is `runCalculation()` actually executed against the seeded JSON. The conservation invariant (§4.7) holds exactly — every cascade output sums to $983,370 with $0 drift.

|                              | Conservative | **Expected** | Aggressive |
|---                           |---:          |---:          |---:        |
| DPC eliminated               | $80,110      | $97,277      | $108,721   |
| Repricing savings (B)        | $229,406     | $236,085     | $239,711   |
| ER reduction (C)             | $7,562       | $18,906      | $30,249    |
| Indemnity offset             | $104,736     | $103,608     | $101,252   |
| Stop-loss shift              | $205,485     | $254,948     | $254,544   |
| **Residual fund**            | **$356,070** | **$272,547** | **$248,893** |
| Residual PEPM                | $183.16      | $140.20      | $128.03    |
| Funding × `risk_margin` †    | $256.43      | $175.25      | $140.83    |
| **Total OffPlan PEPM**       | **$611.43**  | **$510.25**  | **$455.83** |
| Total OffPlan Annual         | $1,188,618   | $991,923     | $886,142   |
| **Net Annual Savings**       | **−$1,168**  | **+$195,527** | **+$301,308** |
| As % of current total spend  | −0.1 %       | +16.5 %      | +25.4 %    |

† Deprecated v3.0/v3.1 placeholder. `Total OffPlan PEPM = $195 membership + (residual_pepm × risk_margin) + scenario.stop_loss_pepm + $40 TPA`. Replaced by stochastic Min Required Liquidity in the spec; not yet computed here. See §11 and the calibration note at the end of §8.3.

### 8.3 Reading the result

Under the **Expected** preset, ABC delivers **+$196K (16.5 %)** of annual savings vs the $1.19M current total — driven primarily by cash-pay repricing on Bucket B (**$236K** of savings, ~57 % compression on the $415K of Bucket-B allowed) and the structural shift of catastrophic dollars into the stop-loss layer (**$255K**). DPC absorbs another **$97K**; indemnity offsets **$104K** of mid-acuity event cost. **Conservative** lands essentially at parity (−$1.2K, within rounding); **Aggressive** produces **+$301K (25.4 %)**.

The mechanics line up with how the OffPlan transformation is supposed to work: the cash-pay network attacks specialty / imaging / ASC pricing at the 200–300 % of Medicare reality it sits at, compressing 40–55 %; DPC absorbs predictable primary-care and chronic-management dollars; structured indemnity caps employer exposure on triggering events; specific stop-loss carries the catastrophic tail. The result is meaningful run-rate savings across all three input modes — see the cross-case table below.

That said, the spec is explicit that the **headline savings story still lives in the stochastic capital layer**, not the run-rate comparison (Liquidity Spec §27.1, verbatim):

> **The OffPlan thesis is NOT "lower run-rate spend" — it's "lower required capital to support the same run-rate."**

The deterministic layer demonstrates the run-rate piece (16–30 % savings under Expected / Aggressive across all three demos). The Capital Efficiency Ratio multiplier (≈ 3× per the spec's §27 worked example) requires Min Required Liquidity vs Equivalent Level-Funded Reserve from the stochastic layer — see §11.

The cascade was also run for XYZ Construction (Mode 2, level-funded) and Riverdale Hospitality (Mode 3, fully insured). Aggregate results, all under the **Aggressive** preset:

|                          | Lives | Σ allowed   | Total OffPlan Annual | Current Total | Net Savings   |
|---                       |---:   |---:         |---:                  |---:           |---:           |
| ABC Manufacturing        | 162   | $983,370    | $886,142             | $1,187,450    | **+$301,308** (+25.4 %) |
| XYZ Construction         | 98    | $540,000    | $507,720             | $612,000      | **+$104,280** (+17.0 %) |
| Riverdale Hospitality    | 205   | $1,109,446  | $1,230,844           | $1,750,000    | **+$519,156** (+29.7 %) |

All three demos turn positive under Expected, with the strongest savings on Riverdale (fully insured, where premium loadings are highest). Under **Conservative**, XYZ Construction is the one outlier (−11.7 %) — reflecting that level-funded SMBs at the lower end of premium loading don't always benefit under the most pessimistic assumptions (Conservative bumps `risk_margin` to 1.40× and `stop_loss_pepm` to $120). That's an honest depiction of where the deterministic-layer model has friction; ABC at parity (−0.1 %) and Riverdale positive (+3.9 %) under the same Conservative settings.

Numbers above are produced by direct invocation of the engine modules (`runCalculation` from `src/engine/calculate.js` against the seeded demo JSON) and reproduce what the dashboard renders for each demo on load.

#### Calibration history (May 2026)

The shipped demo numbers above reflect a four-change re-baseline driven by a structural diagnostic of the original demo data:

1. **Stop-loss premium PEPM** dropped from `$200/$175/$150` (Conservative/Expected/Aggressive) to **`$120/$100/$80`** to track typical SMB specific-stop-loss premium at $50K attachment. The original placeholder was roughly 1.5–2× the market range and was the dominant inflator of the OffPlan stack.
2. **Synthetic distribution recalibrated** in `src/engine/synthetic.js → SYNTHETIC_DISTRIBUTION`: Specialty Rx 8 % → **16 %**, Outpatient Surgery 10 % → **12 %**, Inpatient 18 % → **20 %**, Imaging avg claim $800 → **$1,600**, Procedures avg claim $2,400 → **$4,800** (200–300 % of Medicare reality). Other lines trimmed proportionally to keep shares summing to 1.0.
3. **Riverdale Hospitality `current_total_healthcare_spend`** lifted from `$1,340,000` → **`$1,750,000`** ($711 PEPM) to track defensible fully-insured premium for a 205-life hospitality group.
4. **Risk-margin × residual placeholder retained as-is** (still flagged "deprecated v3.0/v3.1" in the dashboard). Removing it now would silently under-fund the residual without any replacement; the spec replaces the whole construct with stochastic Min Required Liquidity in a later build.

---

## 9. Scenarios

Three presets in `src/constants.js → SCENARIO_PRESETS`. All eight knobs are editable on the Scenario screen; admin edits create new immutable rule/pricing/indemnity versions and lock to scenarios at creation time.

|                            | Conservative | **Expected** | Aggressive |
|---                         |---:          |---:          |---:        |
| `dpc_elimination_pct`      | 70 %         | **85 %**     | 95 %       |
| `urgent_care_reduction_pct`| 50 %         | **65 %**     | 80 %       |
| `er_reduction_pct`         | 10 %         | **25 %**     | 40 %       |
| `cashpay_discount_factor`  | 70 %         | **50 %**     | 40 %       |
| `attachment_point`         | $75K         | **$50K**     | $50K       |
| `stop_loss_pepm`           | $120         | **$100**     | $80        |
| `risk_margin`              | 1.40×        | **1.25×**    | 1.10×      |

Conservative is underwriting-safe; Expected is the default for employer conversations; Aggressive demonstrates the structural ceiling of the model.

---

## 10. Versioning & provenance

Admin edits to cash prices, indemnity benefits, repricing factors, or CPT rules **never mutate in place**. They cut a new immutable version via `cutNewVersion()` (`App.jsx:86-122`), which:

1. Archives the prior `active` row.
2. Prepends a new `active` row with the change_summary and timestamp.
3. Writes a row to `global:audit_log` (capped at 500 entries, prepended).

Every ingested claim is stamped with the IDs of the currently active versions, so a report regenerated months later resolves the exact pricing/rules/indemnity that produced its numbers. Re-running a saved scenario produces identical results regardless of currently active versions — the **integrity guarantee**.

---

## 11. What this build does **not** compute (yet)

Per Master Spec v3.3 + Liquidity Spec v1.2, the headline capital outputs (which are what defends the OffPlan thesis to a CFO board or stop-loss MGU) come from the **stochastic capital layer**:

| Spec metric                       | Status in this build |
|---                                |---                   |
| Min Required Liquidity (P95 of max rolling 30-day Net Drawdown) | **Not computed** — dashboard shows `—`                         |
| Equivalent Level-Funded Total Cost (capital, total-to-total)    | **Not computed** — only run-rate `current_total_healthcare_spend` is surfaced |
| Capital Efficiency Ratio (CER = ELF / MRL)                      | **Not computed**                          |
| Liquidity Reduction percentage (1 − MRL/ELF)                    | **Not computed**                          |
| Liquidity Coverage Ratio (LCR), Stress Coverage Ratio (SCR)     | **Not computed**                          |
| P50 / P75 / P90 / P95 / P99 monthly outflow with bootstrap CI   | **Not computed**                          |
| Replenishment-aware Net Drawdown                                | **Not computed**                          |
| Reimbursement-lag Pre-Reimbursement Outflow                     | **Not computed**                          |
| Heavy-tail Pareto for inpatient tiers (T8/T9)                   | **Not modeled** — synthetic generator uses uniform variance only |
| Aggregate stop-loss corridor                                    | **Not modeled**                           |
| Chronic clustering / ICD-10 chronic derivation                  | `chronic_flag` is set in synthetic data but does not drive event clustering |

These are the modules required by the spec (Modules 6, 7, 9, 10, 11) and are deferred to a follow-on build. The dashboard's amber banner makes this explicit so a viewer doesn't mistake the deterministic output for the headline capital number.

**Bottom line for stakeholders:** this prototype is sufficient to demonstrate *which dollars move where* under OffPlan, and to produce a directional run-rate savings comparison for a real employer. It is **not yet** sufficient to produce the Min Required Liquidity number that a stop-loss MGU will bind on, nor the CER multiplier the spec uses to claim "OffPlan requires N×N less capital than level-funded." Those numbers require the stochastic layer.

---

## 12. Demo cases

`src/demo-cases.js` ships three pre-built employer cases that load with one click from the Cases screen. Each exercises a distinct input mode + scenario combination, so a viewer sees the full cascade without needing to source real claims data.

| Case                          | Mode    | Scenario     | Loader        | Lives | Historical claims | Current total spend |
|---                            |---      |---           |---            |---:   |---:               |---:                 |
| **ABC Manufacturing**         | Full    | Expected     | `json_full`   | 162   | $950,000          | $1,187,450          |
| **XYZ Construction**          | Partial | Conservative | `rows_partial`| 98    | $540,000          | $612,000            |
| **Riverdale Hospitality**     | Modeled | Aggressive   | `json_full` (mode override = "modeled") | 205 | $1,080,000 | $1,750,000 |

Loader kinds (interpreted by `App.jsx → loadDemoCase()`):

- `json_full` — fetch a frozen JSON claim file from `public/data/`. Deterministic across loads. Used for both ABC (Mode 1) and Riverdale (Mode 3) so the demo numbers don't drift between viewings.
- `synthetic_full` — run `generateSyntheticClaims()` at runtime. Non-deterministic (`Math.random()`).
- `csv_partial` — fetch a CSV from `public/data/`, parse with PapaParse, run `decomposePartialSummary()`.
- `rows_partial` — inline rows array, also runs `decomposePartialSummary()`. XYZ Construction uses this so the demo data is visible in source.
- `modeled` — Mode 3 path; runs the generator and stamps `input_mode = "modeled"`.

The frozen JSONs are produced by `scripts/generate-demo-claims.mjs` using a seeded mulberry32 PRNG that temporarily replaces `Math.random` while the generator runs. Editing the synthetic generator without re-running `npm run gen-demo` causes the live `synthetic_full` path and the frozen `json_full` path to diverge.

---

## 13. Project structure

```
src/
  App.jsx                  Single source of truth: all state, screen routing, ingestion, version cutting
  constants.js             DEFAULT_CPT_RULES, cash prices, indemnity benefits, reprice factors, presets
  demo-cases.js            Three pre-built employer cases (ABC, XYZ, Riverdale)
  storage.js               localStorage wrapper with in-memory fallback (db.get/set/list/delete)
  engine/
    classify.js            normalizeAndClassify — bucket precedence resolution
    calculate.js           runCalculation — the five-stage cascade
    synthetic.js           generateSyntheticClaims (Mode 3), decomposePartialSummary (Mode 2)
  screens/
    CasesScreen, SetupScreen, UploadScreen, ClassifyScreen,
    ScenarioScreen, DashboardScreen, ReportScreen, AdminScreen
  ui/                      Header, Toast, Field, BucketBadge, Provenance, formatters

public/data/               Frozen demo JSONs + CSV templates (Templates 1, 2, 3 from spec)
scripts/
  generate-demo-claims.mjs Seeded regeneration of demo_*_claims.json
docs/                      Authoritative spec docs (Master Spec v3.3, Liquidity Spec v1.2, etc.)
```

There is no router. Screen state lives in `App.jsx` (`screen` + `setScreen`). The typical user flow is **Cases → Setup → Upload → Classify → Scenario → Dashboard → Report**. Admin is the side door for cash-pay / indemnity / repricing / CPT-rule edits.

Styling is Tailwind via CDN (`<script src="https://cdn.tailwindcss.com">` in `index.html`); no Tailwind build step. The TODO in `index.html` notes the intent to migrate to Tailwind v4 once the design stabilizes.

### Legacy artifacts (not part of the build)

The repo root contains pre-refactor reference material that is **not** consumed by Vite:

- `05_OffPlan_Engine_Reference_Implementation.jsx` — the original ~3.4k-line monolithic Claude-Artifact-era component, preserved for reference.
- `OffPlan_Engine_Build_Package_v1_0_FINAL (1).zip` — original spec bundle.

The Vite app only consumes `src/`, `public/`, and `index.html`. Don't edit the legacy files expecting them to affect the running app.

---

## 14. Spec references

The authoritative documents live in `docs/`. Read in this order if onboarding:

1. `00_OffPlan_Engine_CTO_Build_Package_Cover_Memo_v12.docx` — orientation, the four non-negotiables.
2. `01_OffPlan_Engine_Master_Specification_v33.docx` — product spec; build-ready.
3. `06_OffPlan_Engine_Liquidity_Capital_Modeling_Spec_v12.docx` — stochastic / capital-adequacy math (read Part 0 — Terminology Lockdown — first).
4. `02_OffPlan_Engine_Data_Dictionary_v3.docx` — schema, CSV templates, provenance fields.
5. `03_OffPlan_Engine_Architecture_Security_Spec_v1.docx` — multi-tenant SaaS, PHI controls, SOC 2 + HIPAA.
6. `04_OffPlan_Engine_CSV_Templates_Package_v21.docx` — three input templates with chronic-flag ingestion.
7. `05_OffPlan_Engine_Reference_Implementation_Guide_v1.docx` — orientation for this codebase as a reference for the production team.
8. `07_OffPlan_Engine_Delta_Document_v33_v12.docx` — concise delta from v3.2/v1.1; useful if you've already read prior versions.

The four spec items that are **non-negotiable** in any production reimplementation:

1. **Calculation order** — DPC → cash-pay → indemnity → stop-loss (member-aggregated) → residual.
2. **Baseline distinction** — historical claims drive the math; current total healthcare spend drives the savings comparison. Never substitute one for the other.
3. **Two-block output structure** — Executive Summary + Liquidity Profile (both produced together once the stochastic layer ships).
4. **Provenance** — eight provenance fields stamped at ingestion and propagated through every output.
