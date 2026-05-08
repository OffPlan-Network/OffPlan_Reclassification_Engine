# OffPlan Claims Reclassification Engine — Reference Implementation

An interactive, single-page React demo of the **OffPlan Claims Reclassification Engine**: a five-stage classification cascade that takes an employer's historical healthcare claims, reclassifies every dollar under the OffPlan architecture (DPC eliminated → cash-pay repriced → indemnity offset → stop-loss shifted → residual funded), and surfaces the resulting employer-cost story.

This codebase is the **deterministic classification layer** plus a **two-mode stochastic capital layer** (timing-resample + tier-generated v3) of the engine described in `docs/01_OffPlan_Engine_Master_Specification_v33.docx` and `docs/06_OffPlan_Engine_Liquidity_Capital_Modeling_Spec_v12.docx`. Heavy-tail Pareto events, NegBin frequency for over-dispersed tiers, complication probability + lag, chronic-flag clustering with a DPC clinical-mitigation factor, aggregate stop-loss corridor, and bootstrap 95% CIs on every percentile are all live; the T10 monthly-recurrence model and the T11 bimodal Maternity/NICU split remain deferred — see §11 for the per-metric status.

The companion docs in `docs/` are the authoritative spec; this README is the operator-facing summary of how the running app implements them.

---

## 1. Quick start

```bash
npm install
npm run dev          # Vite dev server with HMR (localStorage backend)
npm run dev:vercel   # Vite + /api/* Vercel Functions on http://localhost:3000 (DB backend)
npm run build        # production build → dist/
npm run preview      # serve the built dist/ locally
npm run gen-demo     # regenerate frozen demo JSONs in public/data/
npm run db:push      # apply Drizzle schema to Neon (DDL)
npm run db:smoke     # exercise the storage handlers against Neon directly
npm run api:test     # spawn local API server + run HTTP-level smoke
npm run test:e2e     # Playwright UI smoke against vercel dev
```

Persistence has two backends, switched by `VITE_STORAGE_BACKEND` in `.env.local`:
- `localStorage` (default) — namespaced under `offplan_engine:`, with an in-memory fallback for sandboxed contexts
- `api` — reads/writes go to `/api/storage/*` (Vercel Functions backed by Neon Postgres via Drizzle)

Both are wired through the same `db` interface in `src/storage.js` so the rest of the app is backend-agnostic.

To move existing localStorage data into Postgres after flipping the backend, open `/migrate.html` in the browser (same origin as your data — local dev or Vercel preview), confirm the inventory, untick "Dry run", and click "Run migration". Idempotent — running twice overwrites the same rows.

Deployment: Vercel, via its GitHub integration — Vercel watches `master`/`main` and ships every push. The `/api/*` directory is auto-deployed as Serverless Functions; the SPA serves from `dist/`.

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

Anchored to **`OffPlan Financial Model Assumptions Reference (Source of Truth)` — May 2026, Section 2 (Complete Stack PEPM Build)**. The Expected scenario lands at the doc's **$582.20 all-in PEPM** anchor (single coverage).

```
Fixed overhead (OFFPLAN_FIXED_OVERHEAD_PEPM = $282.20):
      OFFPLAN_MEMBERSHIP_PEPM           $185.00   locked (Section 1)
    + PBM_ADMIN_PEPM                    $  8.00   working assumption — finalize w/ Yuzu PBM RFP
    + FIRSTHEALTH_PEPM                  $  5.95   confirmed — Yuzu rate card (OOA fallback)
    + MEDWATCH_PEPM                     $  3.25   confirmed — Yuzu rate card (UM/CM)
    + ACCIDENT_INDEMNITY_PEPM           $ 40.00   working assumption — finalize w/ TownHealth or equivalent
    + TPA_PEPM                          $ 40.00   confirmed — Yuzu

Total OffPlan PEPM =
      OFFPLAN_FIXED_OVERHEAD_PEPM       ($282.20)
    + scenario.stop_loss_pepm           ($85 / $100 / $130 by preset)
    + recommended_funding_pepm          (residual_pepm × scenario.risk_margin)†

Annual: Total OffPlan PEPM × covered_lives × 12

Net Annual Savings = current_total_healthcare_spend − OffPlan Annual
```

Stop-loss preset spread reflects the doc's Section 3 disclosure that *"carriers will price initial coverage based on conservative assumptions until population experience validates the lower claims fund expectation, which may push initial stop-loss premiums above the $100 PEPM working assumption."* Expected ($100) sits at the doc anchor; Conservative ($130) overshoots the anchor for pre-experience underwriting; Aggressive ($85) reflects post-experience pricing once population data validates.

† **The `risk_margin × residual_pepm` step is the deprecated v3.0/v3.1 funding construct.** Master Spec v3.3 §6.6 retires it in favor of stochastic Min Required Liquidity. The doc's working anchor for this layer is **$200 PMPM** (range $140–$240, Section 3). The dashboard labels it "deprecated intermediate placeholder" and shows Min Required Liquidity as `—` until the stochastic layer ships. Treat the resulting funding number as a **conservative, deterministic placeholder** — adequate for an order-of-magnitude employer conversation, not for an MGU underwriting submission.

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
historical_claims_spend        = $985,000     (claims-fund portion)
current_total_healthcare_spend = $1,525,000   (self-funded total plan cost — ~$785 PEPM Y1
                                              traditional self-funded benchmark per the
                                              Source-of-Truth doc Section 6)
```

Frozen demo JSON (`public/data/demo_abc_manufacturing_claims.json`) contains 1,758 deterministic claim lines totaling $950,335 — within rounding of the $950K nominal claims target. Because the demo file is seeded, the math is reproducible across runs. The May 2026 generator update redistributed claims along a log-normal utilization curve (per-member spend now heavy-tailed: top 5% own ~49% of non-routine spend), which is what produces the realistic chronic_flag stamping and the auto-estimated 30.2% chronic prevalence.

### 8.1 Bucket distribution (after `normalizeAndClassify`)

|        | Claims | Σ allowed | Share of historical |
|---     |---:    |---:       |---:                 |
| **A** Primary care, lab, prevention | 1,067 | $113,963 | 12.0 % |
| **B** Specialty, imaging, ASC, urgent care | 552 | $413,649 | 43.5 % |
| **C** ER | 42 | $69,516 | 7.3 % |
| **D** Specialty Rx + Other | 90 | $160,747 | 16.9 % |
| **E** Inpatient (catastrophic) | 7 | $192,460 | 20.3 % |
| **Total** | **1,758** | **$950,335** | 100.0 % |

### 8.2 Cascade output, all three presets

Each row below is `runCalculation()` actually executed against the seeded JSON. The conservation invariant (§4.7) holds exactly — every cascade output sums to $950,335 with $0 drift.

|                              | Conservative | **Expected** | Aggressive |
|---                           |---:          |---:          |---:        |
| DPC eliminated               | $79,774      | $96,869      | $108,265   |
| Repricing savings (B)        | $225,462     | $232,339     | $236,073   |
| ER reduction (C)             | $6,952       | $17,379      | $27,806    |
| Indemnity offset             | $115,641     | $113,792     | $110,442   |
| Stop-loss shift              | $23,479      | $53,471      | $52,705    |
| **Residual fund**            | **$499,027** | **$436,485** | **$415,044** |
| Residual PEPM                | $256.70      | $224.53      | $213.50    |
| Funding × `risk_margin` †    | $359.38      | $280.66      | $234.85    |
| **Total OffPlan PEPM**       | **$771.58**  | **$662.86**  | **$602.05** |
| Total OffPlan Annual         | $1,499,955   | $1,288,604   | $1,170,385 |
| **Net Annual Savings**       | **+$25,045** | **+$236,396** | **+$354,615** |
| As % of current total spend  | +1.6 %       | +15.5 %      | +23.3 %    |

† Deprecated v3.0/v3.1 placeholder. `Total OffPlan PEPM = $282.20 fixed overhead (membership + PBM + FirstHealth + MedWatch + Accident/Indemnity + TPA) + scenario.stop_loss_pepm + (residual_pepm × risk_margin)`. Replaced by stochastic Min Required Liquidity in the spec; not yet computed here. See §6, §11, and the calibration note at the end of §8.3.

The Expected funding × `risk_margin` of **$280.66 PEPM** sits at the upper edge of the Source-of-Truth doc's $140–$240 working range (Section 3). Combined with the $382.20 fixed + stop-loss subtotal, Expected lands at **$662.86 PEPM** — above the doc's $582.20 all-in anchor by ~14 %, reflecting that the heavy-tailed synthetic generator (introduced May 2026) now produces a larger employer-funded residual than the prior uniform-distribution generator did. The doc's anchor itself was calibrated against the older numbers; expect the next anchor refresh in §6 to track the realistic concentration.

### 8.3 Reading the result

Under the **Expected** preset, ABC delivers **+$236K (15.5 %)** of annual savings vs the $1.525M current total — driven primarily by cash-pay repricing on Bucket B (**$232K** of savings, ~56 % compression on the $414K of Bucket-B allowed) and indemnity offset on mid-acuity events (**$114K**). DPC absorbs another **$97K**. Stop-loss shift is comparatively small (**$53K**) because the heavy-tailed member distribution concentrates non-routine claims on ~30 % of the population — only the top utilizers cross the $50K member-aggregate attachment, and most of the per-member cost stays as employer residual. **Aggressive** widens to **+$355K (+23.3 %)**. **Conservative essentially breaks even at +$25K (+1.6 %)** — the combination of the $130 PEPM stop-loss premium, the 1.40× risk-margin amplification on a now-larger residual, and the $75K Conservative attachment (which keeps even more spend out of stop-loss) compresses the margin to roughly run-rate parity. This is a more realistic Conservative outcome than the prior +14.8 % under the uniform-distribution generator, which understated employer residual exposure.

This savings range — Conservative +1.6 %, Expected +15.5 %, Aggressive +23.3 % — tracks the realistic OffPlan story for a chronic-mix population: meaningful but not dramatic run-rate savings under realistic underwriting, with the headline Capital Efficiency story coming from the stochastic layer (§11) where MRL is roughly one-fifth of Equivalent Level-Funded Reserve.

The mechanics line up with how the OffPlan transformation is supposed to work: the cash-pay network attacks specialty / imaging / ASC pricing at the 200–300 % of Medicare reality it sits at, compressing 40–55 %; DPC absorbs predictable primary-care and chronic-management dollars; structured indemnity caps employer exposure on triggering events; specific stop-loss carries the catastrophic tail. The result is meaningful run-rate savings across all three input modes — see the cross-case table below.

That said, the spec is explicit that the **headline savings story still lives in the stochastic capital layer**, not the run-rate comparison (Liquidity Spec §27.1, verbatim):

> **The OffPlan thesis is NOT "lower run-rate spend" — it's "lower required capital to support the same run-rate."**

The deterministic layer demonstrates the run-rate piece (12–27 % savings on the two stronger demos under Expected / Aggressive; XYZ at parity under Expected). The Capital Efficiency Ratio multiplier (≈ 3× per the spec's §27 worked example) requires Min Required Liquidity vs Equivalent Level-Funded Reserve from the stochastic layer — see §11.

The cascade was also run for XYZ Construction (Mode 2, level-funded) and Riverdale Hospitality (Mode 3, fully insured). Aggregate results, all under the **Aggressive** preset:

|                          | Lives | Σ allowed   | Total OffPlan Annual | Current Total | Net Savings   |
|---                       |---:   |---:         |---:                  |---:           |---:           |
| ABC Manufacturing        | 162   | $950,335    | $1,170,385           | $1,525,000    | **+$354,615** (+23.3 %) |
| XYZ Construction         | 98    | $540,000    | $569,147             | $840,000      | **+$270,853** (+32.2 %) |
| Riverdale Hospitality    | 205   | $1,060,541  | $1,357,281           | $2,400,000    | **+$1,042,719** (+43.4 %) |

Under **Expected**, the demos split by chronic-mix realism: ABC +15.5 %, XYZ +23.9 %, Riverdale +38.0 %. Riverdale (hospitality, older + sedentary workforce) shows the strongest savings because the chronic-heavy population lets DPC + indemnity carry more of the load. ABC (manufacturing, broader age mix) is in the middle. XYZ (construction, partial-summary Mode 2) sits in between but is more sensitive to how the partial decomposition assigns claims. Under **Aggressive**, savings widen to +23 %–+43 %. Under **Conservative**, the $130 PEPM stop-loss premium and 1.40× risk-margin amplification combined with the $75K attachment compress savings: ABC nearly breaks even at +1.6 %, XYZ at +10.2 %, Riverdale still strong at +27.1 %. The Conservative-preset compression on ABC reflects that the heavy-tailed claim distribution (May 2026 generator update) concentrates cost on chronic members but keeps most below the high attachment, leaving more as employer residual that the risk-margin then amplifies through the deprecated v3.0/v3.1 placeholder.

Numbers above are produced by direct invocation of the engine modules (`runCalculation` from `src/engine/calculate.js` against the seeded demo JSON) and reproduce what the dashboard renders for each demo on load.

#### Calibration history (May 2026)

The shipped demo numbers above reflect a multi-pass re-baseline. The primary anchor is now the internal **`OffPlan Financial Model Assumptions Reference (Source of Truth)` — May 2026** (`docs/OffPlan_Financial_Model_Assumptions_Reference.docx`); the broker-survey work that drove the prior pass is retained as cross-check.

1. **OffPlan stack rebuilt against the doc's Section 2.** `OFFPLAN_MEMBERSHIP_PEPM` dropped from `$195` to **`$185`** (locked); the stack now also includes `PBM_ADMIN_PEPM = $8` (working assumption, finalize via Yuzu PBM RFP), `FIRSTHEALTH_PEPM = $5.95` (Yuzu rate card, confirmed), `MEDWATCH_PEPM = $3.25` (Yuzu rate card, confirmed), and `ACCIDENT_INDEMNITY_PEPM = $40` (working assumption, finalize w/ TownHealth or equivalent). `TPA_PEPM` stays at `$40` (Yuzu confirmed). Sum is `OFFPLAN_FIXED_OVERHEAD_PEPM = $282.20`. Combined with the Expected stop-loss line ($100) and the deterministic claims-fund placeholder, ABC's Expected scenario lands at **$662.86 all-in PEPM** under the May 2026 heavy-tailed generator (was $557.45 under the prior uniform-distribution build, near the doc's $582.20 anchor). The shift reflects that the heavy-tailed distribution leaves more spend on the employer residual side of the cascade rather than crossing stop-loss attachment; the doc's anchor itself was calibrated against the old generator and will need a refresh.

2. **Stop-loss premium PEPM** moved from `$175/$130/$100` (Conservative/Expected/Aggressive) to **`$130/$100/$85`** to anchor on the doc's Section 2 working assumption of `$100 PEPM` and Section 3 disclosure that *"carriers will price initial coverage based on conservative assumptions until population experience validates the lower claims fund expectation, which may push initial stop-loss premiums above the $100 PEPM working assumption."* Expected sits at the doc anchor; Conservative reflects the pre-experience underwriting markup; Aggressive reflects post-experience pricing once population data validates.

   The earlier broker-survey calibration ([Aegis Risk 2025](https://www.iscebs.org/docs/iscebslibraries/uploadedfiles/surveys/aegis-risk-survey-2025.pdf), [IFEBP Aegis recap](https://blog.ifebp.org/stop-loss-premiums-increase-to-over-10-annually/), [Ethos Benefits Stop-Loss Cost Guide](https://ethosbenefits.com/how-much-does-stop-loss-insurance-cost/), [Milliman 2024 Stop-Loss Survey](https://www.milliman.com/en/insight/observations-employer-stop-loss-market-2024-survey)) remains the external cross-check: the new spread `$85–$130 PEPM` sits at the lower-middle of the Ethos broker SMB band ($50–$150 PEPM, avg $100), well within the all-sizes-weighted Aegis 2025 anchor ($229.40 PEPM at $100K).

   **Caveat — read before any commercial conversation.** No public source publishes specific-stop-loss PEPM at exactly $50K attachment for the SMB segment. The values above are **defensible as demo inputs** anchored to the Source-of-Truth doc, but **not market-verified for any specific employer**. Before any MGU conversation or board-grade comparison, these values must be replaced with actual carrier quotes for the employer in question.

3. **Demo `current_total_healthcare_spend` re-anchored to the doc's Section 6 Y1 industry benchmarks** ($785 PEPM traditional self-funded, $715 level-funded, $975 fully-insured BUCA): ABC `$1,187,450` → **`$1,525,000`** (~$785 PEPM at 162 lives), XYZ `$612,000` → **`$840,000`** (~$715 PEPM at 98 lives), Riverdale `$1,750,000` → **`$2,400,000`** (~$975 PEPM at 205 lives). Historical claims spend nudged for ABC/Riverdale to keep nominal totals close to the frozen JSON sums.

4. **Synthetic distribution recalibrated** in `src/engine/synthetic.js → SYNTHETIC_DISTRIBUTION`: Specialty Rx 8 % → **16 %**, Outpatient Surgery 10 % → **12 %**, Inpatient 18 % → **20 %**, Imaging avg claim $800 → **$1,600**, Procedures avg claim $2,400 → **$4,800** (200–300 % of Medicare reality). Other lines trimmed proportionally to keep shares summing to 1.0.

5. **Risk-margin × residual placeholder retained as-is** (still flagged "deprecated v3.0/v3.1" in the dashboard). The doc's Section 3 working anchor for this layer is **$200 PMPM** (range $140–$240). Removing the placeholder now would silently under-fund the residual without any replacement; the spec replaces the whole construct with stochastic Min Required Liquidity in a later build.

6. **Synthetic generator made heavy-tailed** (May 2026) in `src/engine/synthetic.js`. Each synthetic member now receives a log-normal utilization weight (sigma=1.0) at run start; the top 28% by weight are stamped `chronic_flag: true` directly on every claim they generate, and weighted random sampling drives non-Bucket-A claim assignment. The previous uniform-distribution generator distributed claims sequentially across all members, which made the chronic-prevalence auto-estimator return implausible values (96–100 % on synthetic demos) and overstated stop-loss attachment crossings. The new generator produces realistic claim concentration (top 5% drive ~49% of non-routine spend, top 20% drive ~78%), which is more aligned with real-world Milliman/MEPS utilization curves. The downstream effect on the cascade: Conservative/Expected residuals grew (more spend stays as employer residual instead of crossing the $50K member-aggregate stop-loss attachment), savings narrative compressed (ABC Expected: 28.9% → 15.5%, more realistic for an SMB chronic-mix population), and CER bands adjusted (5–8× under Expected vs the prior 4–8.5×). Frozen demo JSONs were regenerated via `npm run gen-demo`.

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
| `stop_loss_pepm`           | $130         | **$100**     | $85        |
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

## 11. Stochastic liquidity layer — v3 scope

The Monte Carlo in `src/engine/stochastic.js` ships **two simulation modes**, surfaced as a toggle on the Dashboard. They answer subtly different questions:

| Mode | Question answered | Calibration anchor | When to use |
|---|---|---|---|
| **`timing-resample`** (default) | "Given this employer's actual claims, how much liquidity did they need to weather that year's worst-month drawdown?" | The deterministic engine's residual_fund (matches by construction) | Primary number for CFO conversations; calibrated to actual claims |
| **`tier-generated`** (v3) | "Given a typical SMB at this employer's size, how much liquidity should they expect?" | Industry-typical SMB event mix (`EVENT_TIER_CATALOG` in `src/constants.js`) | Sensitivity check; drift-pct shows how this employer compares to the SMB norm |

The catalog has 11 tiers per Spec v1.2 §4 (T1 primary care through T11 maternity), with Poisson frequency × log-normal cost for non-catastrophic tiers, NegBin frequency for inpatient T8 (over-dispersion), and Pareto cost for T8/T9. Sampled events run through the full member-aggregating cascade (per-event reduction → indemnity offset → member-aggregate stop-loss → aggregate corridor) — same five-stage logic the deterministic engine uses, inlined for performance. 1,000 runs land in <500 ms client-side; 5,000 runs in <2s server-side.

**Both modes share:**
- Pareto catastrophic event tail overlay in timing-resample mode (default λ=0.005 per member-year, scale=$50K, shape=1.5 → mean $150K)
- 3-month stop-loss reimbursement lag
- Stop-loss claim payment spread: catastrophic claims (`stop_loss_amount > 0`) spread cash outflow 1/3 / 1/3 / 1/3 across three months to model adjudication delay + invoice terms; smaller cash-pay claims settle same-month. Override via `options.stopLossPaymentSchedule = [1]` to disable.
- Monthly resolution
- 5,000 runs server-side / 1,000 client-side

| Spec metric                       | Status in this build |
|---                                |---                   |
| Min Required Liquidity (P95 of max cumulative drawdown) | **Computed** — 1,000 runs, monthly resolution, 3-month stop-loss reimbursement lag |
| Equivalent Level-Funded Total Cost (ELF) | **Computed** — uses `current_total_healthcare_spend` as the level-funded proxy |
| Capital Efficiency Ratio (CER = ELF / MRL) | **Computed**          |
| Liquidity Reduction percentage (1 − MRL/ELF) | **Computed**        |
| Liquidity Coverage Ratio (LCR), Stress Coverage Ratio (SCR) | **Computed** |
| P50 / P75 / P90 / P95 / P99 of max cumulative drawdown | **Computed** — with bootstrap 95% CIs (500 resamples) on every percentile |
| Replenishment-aware Net Drawdown | **Computed** — monthly contribution = annual cash flow / 12 |
| Reimbursement-lag Pre-Reimbursement Outflow | **Computed** — fixed 3-month lag (75-day approximation) |
| Stop-loss claim payment spread (adjudication delay + invoice terms) | **Computed** — `STOP_LOSS_PAYMENT_SCHEDULE = [1/3, 1/3, 1/3]` in `src/constants.js`; applied to claims with `stop_loss_amount > 0` only. Reduces MRL by 30–45% vs single-month outflow on catastrophic-heavy populations |
| Heavy-tail Pareto for inpatient catastrophic events | **Computed** — overlay in timing-resample (default λ=0.005/member-yr, scale=$50K, shape=1.5); native to T8/T9 in tier-generated |
| Full 11-tier event catalog with per-tier Poisson frequencies | **Computed** — `EVENT_TIER_CATALOG` in `src/constants.js` is the v2 mode's source of truth |
| Calibration drift indicator | **Computed** — drift_pct + out_of_band flag returned per simulation; UI banner fires at ±10% |
| NegBin frequency for over-dispersed tiers | **Computed** — T8 (inpatient) uses NegBin via Gamma-Poisson mixture; other tiers remain Poisson |
| Indemnity offset in tier-generated mode | **Computed** — applies the same per-member per-event-type benefit caps the deterministic cascade uses |
| Member-aggregate stop-loss split in tier-generated mode | **Computed** — events grouped by member, overage drained from largest claims |
| Aggregate stop-loss corridor | **Computed** — opt-in via scenario flag; reimburses excess residual at month 11 when annual residual breaches `expected × attachment_pct` |
| Complication probability + lag (Spec v1.2 §4.1) | **Computed** — tiers 5–9 roll for a complication on the same member with log-normal lag, depth-capped at 3; rate scaled by `(1 − dpc_clinical_mitigation_pct)` |
| Chronic_flag-driven event clustering (Spec v1.2 §4.1) | **Computed** — `CHRONIC_PREVALENCE = 0.28` of the run's member pool (or `employer.chronic_prevalence` override, auto-estimated from claims at ingestion via `src/engine/calibration.js`) draws events at λ × effective_uplift on T2/T4/T5/T6/T7/T8/T10 (`CHRONIC_TIER_UPLIFT` in `src/constants.js`); effective uplift = `1 + (raw_uplift − 1) × (1 − dpc_clinical_mitigation_pct)` |
| Bootstrap confidence intervals on percentiles | **Computed** — 500-resample bootstrap with derived seed; surfaces 2.5%/97.5% bounds on P50/P75/P90/P95/P99 |
| Spec v1.2 monthly-recurrence model for Specialty Rx (T10) | **Computed** — `regimen_mode: 'monthly_recurrence'` on T10 in `EVENT_TIER_CATALOG`; pre-samples `regimen_member_fraction = 3%` of population from the chronic pool, generates `fills_per_member_year = 12` monthly fills per regimen member with cost sampled per fill from the log-normal. Concentrates ~$80–$105 PMPM specialty-Rx exposure on ~3% of members instead of spreading thin across the population. Bypasses the standard chronic-uplift sampling for T10. |
| Spec v1.2 bimodal Maternity/NICU split (T11/T12) | **Computed** — split into T11 routine maternity (Bucket B, λ=0.008, mean $12K, cash-pay repriced like outpatient specialty surgery) and T12 NICU complications (Bucket E, λ=0.002, log-normal σ=0.7 mean $80K with heavy NICU tail). Routine births are plannable care priced at contracted rates; complicated births flow through stop-loss attachment. 80/20 routine/complicated split per CDC/NCHS data. Both still trigger Hospital Admission indemnity offset. |

**Demo calibration — v4 stochastic engine, 5,000 runs, timing-resample mode.**
Includes payment spread (1/3 × 3 months), bootstrap CIs, chronic clustering, complications. Numbers below are reproducible by running the cascade + simulator against the frozen demo claims.

**ABC Manufacturing** (162 lives, $1,525,000 total spend, auto-estimated chronic prevalence 30.2%)

| Scenario | Residual Fund | Residual PEPM | MRL (P95) | P99 | CER | Liquidity Reduction | OffPlan Annual | Net Savings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Conservative | $499,027 | $256.70 | $291,664 | $875,396 | 5.23× | 80.9% | $1,499,955 | $25,045 (1.6%) |
| **Expected** | **$436,485** | **$224.53** | **$299,032** | **$950,868** | **5.10×** | **80.4%** | **$1,288,604** | **$236,396 (15.5%)** |
| Aggressive | $415,044 | $213.50 | $306,513 | $852,418 | 4.98× | 79.9% | $1,170,385 | $354,615 (23.3%) |

**XYZ Construction** (98 lives, $840,000 total spend, auto-estimated chronic prevalence 30.0%)

| Scenario | Residual Fund | Residual PEPM | MRL (P95) | P99 | CER | Liquidity Reduction | OffPlan Annual | Net Savings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Conservative | $183,959 | $156.43 | $208,656 | $563,676 | 4.03× | 75.2% | $742,290 | $97,710 (11.6%) |
| **Expected** | **$124,503** | **$105.87** | **$205,433** | **$575,978** | **4.09×** | **75.5%** | **$605,096** | **$234,904 (28.0%)** |
| Aggressive | $97,995 | $83.33 | $198,818 | $621,731 | 4.22× | 76.3% | $539,621 | $300,379 (35.8%) |

**Riverdale Hospitality** (205 lives, $2,400,000 total spend, auto-estimated chronic prevalence 27.8%)

| Scenario | Residual Fund | Residual PEPM | MRL (P95) | P99 | CER | Liquidity Reduction | OffPlan Annual | Net Savings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Conservative | $524,867 | $213.36 | $314,104 | $773,255 | 7.64× | 86.9% | $1,748,826 | $651,174 (27.1%) |
| **Expected** | **$438,597** | **$178.29** | **$310,497** | **$871,777** | **7.73×** | **87.1%** | **$1,488,459** | **$911,541 (38.0%)** |
| Aggressive | $412,699 | $167.76 | $342,744 | $980,712 | 7.00× | 85.7% | $1,357,281 | $1,042,719 (43.4%) |

CER under Expected lands at **5.10× / 4.09× / 7.73×** across the three demos, comfortably within the Liquidity Spec v1.2 §27 worked-example range (3–10× depending on chronic mix). MRL as a percent of total spend lands at **20% / 24% / 13%** — i.e., the employer needs a liquidity facility roughly one-fifth the size of the level-funded pre-fund a traditional carrier would require. Translating to PEPM-equivalent: MRL/lives/12 = $154 / $175 / $126 PEPM (ABC / XYZ / Riverdale at Expected), bracketing the Spec v1.2 worked-example anchor of $115 PEPM.

ABC and XYZ land in similar CER territory (5.10× and 4.09×) reflecting their similar lives bases and chronic mix. Riverdale's stronger 7.73× reflects the larger covered-lives base (205 vs 162/98) which smooths timing variance across more members, lower MRL as a fraction of total spend.

**Auto-estimated chronic prevalence — generator-stamped today, condition catalog stubbed for production.**

The synthetic generator (`src/engine/synthetic.js`) assigns each member a log-normal utilization weight at run start (sigma=1.0, mu=0); the top `CHRONIC_TOP_FRACTION = 0.28` of members by weight are stamped `chronic_flag: true` directly on every claim they generate. This produces realistic heavy-tailed concentration: top 5% of members own ~49% of non-Bucket-A spend, top 20% own ~78%, matching real-world claim concentration patterns.

`estimateChronicPrevalence(classifiedClaims)` in `src/engine/calibration.js` reads `chronic_flag` directly when present (fast path) and returns the share of unique members flagged. When chronic_flag is absent (raw real claims data without generator enrichment), it falls back to a utilization-pattern heuristic: a member is chronic if at least 2 of (i) ≥6 distinct service months, (ii) ≥4 non-Bucket-A claims, (iii) non-A spend > 3× population per-member mean. The heuristic result is plausibility-clamped to the CDC working-age band [0.10, 0.45]; values outside that band return null, and the engine falls back to the `CHRONIC_PREVALENCE = 0.28` population default.

The condition-aware production path lives in `CHRONIC_CONDITION_CATALOG` (`src/constants.js`) — a 30-condition dictionary with ICD-10 prefixes and cost bands (low/medium/high) that distinguishes cheap chronic conditions (HTN, hypothyroidism, GERD on generics — sub-$2K/yr incremental) from expensive chronic conditions that actually drive MRL (psoriatic arthritis on Cosentyx, RA on Humira, MS on Tysabri, hemophilia on factor concentrates — $50K-$500K+/yr). The simulator's chronic uplift weights what matters: not chronicity per se, but per-member spend concentration on biologics / specialty Rx / dialysis / oncology.

`identifyExpensiveChronicMembers(claims, catalog)` in `src/engine/calibration.js` is the production wiring stub. It returns `[]` today because synthetic claims don't carry diagnosis codes; when real ingestion stamps `c.diagnosis_codes` (or `c.icd10_codes`), the longest-prefix-match logic activates and produces per-member condition profiles. Future iteration should:

1. Use `identifyExpensiveChronicMembers().length / total_members` to refine `estimateChronicPrevalence` when diagnosis codes are present.
2. Surface a per-employer "expensive chronic share" alongside overall prevalence in the `chronic_clustering` result block.
3. Replace the flat `CHRONIC_TIER_UPLIFT` table with per-condition uplift weights — high-cost autoimmune drives T10 specialty Rx differently than HTN drives T2 specialty consults.

For production employers without enriched ICD-10 data, the **manual prevalence override** in Setup is the recommended path (anchored to carrier high-cost-claimant reports or CMS HCC-flagged member counts). The auto-estimate is a directional starting point.

**DPC clinical mitigation factor.** Both complication probability and chronic uplift are scaled by `(1 − scenario.dpc_clinical_mitigation_pct)` — a single knob that captures DPC's clinical effect on event frequency. The model is: monthly-membership primary care absorbs chronic management (so chronic flares route through PCP rather than ER/inpatient) and PCP catches complication early-warnings before they cascade. Preset values: conservative 0.20, expected 0.30, aggressive 0.45. The Pareto tail overlay in timing-resample mode is **not** mitigated — it represents truly catastrophic events (cancer diagnosis, major trauma) where DPC's preventive leverage is weak.

**Per-employer chronic-prevalence calibration.** On every claims ingestion, `estimateChronicPrevalence()` (in `src/engine/calibration.js`) computes the share of unique members whose claims include either a Bucket E event or > $5K of cumulative non-Bucket-A spend, and stamps it on the employer record as `chronic_prevalence` (with `chronic_prevalence_source: 'auto'`). The Setup screen exposes a manual override that flips the source to `'manual'`, after which auto-estimation no longer overwrites it. The stochastic engine reads `employer.chronic_prevalence` and falls back to the population default only when the override is unset or out of range. The `chronic_clustering` block in the result surfaces both the value used and its source.

**Bottom line for stakeholders:** this build implements every Liquidity Spec v1.2 §4 stochastic-layer item: heavy-tail Pareto for catastrophic, NegBin for over-dispersed inpatient, indemnity offset, member-aggregate stop-loss split, aggregate stop-loss corridor, complication probability + lag, chronic clustering with DPC clinical mitigation, per-employer chronic-prevalence calibration, stop-loss claim payment spread (1/3 over 3 months for adjudication delay + invoice terms), monthly-recurrence Specialty Rx regimen for biologic/specialty concentration, bimodal Maternity (routine cash-pay repriced + NICU catastrophic), and bootstrap 95% confidence intervals on every reported percentile. CER lands at 4.1–7.7× under Expected across the demos, P99 in the right order of magnitude for SMB populations, drift_pct ≈ 0% in tier-generated mode (closed-form tracks the simulator). It supports CFO conversations and prospect demos at this level of fidelity. For production-grade MGU underwriting, employer-supplied high-cost-claimant data or full ICD-10 ingestion should replace the auto-estimated chronic prevalence — the `CHRONIC_CONDITION_CATALOG` and `identifyExpensiveChronicMembers` stub are ready for that hydration.

---

## 12. Demo cases

`src/demo-cases.js` ships three pre-built employer cases that load with one click from the Cases screen. Each exercises a distinct input mode + scenario combination, so a viewer sees the full cascade without needing to source real claims data.

| Case                          | Mode    | Scenario     | Loader        | Lives | Historical claims | Current total spend |
|---                            |---      |---           |---            |---:   |---:               |---:                 |
| **ABC Manufacturing**         | Full    | Expected     | `json_full`   | 162   | $985,000          | $1,525,000          |
| **XYZ Construction**          | Partial | Conservative | `rows_partial`| 98    | $540,000          | $840,000            |
| **Riverdale Hospitality**     | Modeled | Aggressive   | `json_full` (mode override = "modeled") | 205 | $1,110,000 | $2,400,000 |

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
  App.jsx                  Single source of truth: all state, screen routing, ingestion, version cutting,
                           chronic-prevalence auto-calibration on every claims ingestion
  constants.js             DEFAULT_CPT_RULES, cash prices, indemnity benefits, reprice factors, presets,
                           EVENT_TIER_CATALOG (11 tiers), CHRONIC_PREVALENCE, CHRONIC_TIER_UPLIFT,
                           CATASTROPHIC_TAIL_DEFAULTS, OFFPLAN_* stack constants
  demo-cases.js            Three pre-built employer cases (ABC, XYZ, Riverdale)
  storage.js               Two-backend db wrapper (localStorage / api), switched by VITE_STORAGE_BACKEND
  engine/
    classify.js            normalizeAndClassify — bucket precedence resolution
    calculate.js           runCalculation — the deterministic five-stage cascade
    synthetic.js           generateSyntheticClaims (Mode 3), decomposePartialSummary (Mode 2)
    stochastic.js          simulateLiquidity — two-mode Monte Carlo MRL simulator
                           (timing-resample + tier-generated v3); chronic clustering, complications,
                           NegBin, aggregate corridor, bootstrap CIs, DPC mitigation
    calibration.js         estimateChronicPrevalence — auto-calibrates per-employer chronic share
                           from classified claims (E-bucket events or > $5K non-A spend)
  hooks/
    useLiquidity.js        Liquidity-fetch state machine; switches between inline simulateLiquidity
                           (localStorage backend) and POST /api/liquidity/simulate (api backend)
  screens/
    CasesScreen, SetupScreen, UploadScreen, ClassifyScreen,
    ScenarioScreen, DashboardScreen, ReportScreen, AdminScreen
  ui/                      Header, Toast, Field, BucketBadge, Provenance, formatters

api/                       Vercel Functions, auto-deployed alongside the SPA
  storage/index.js         GET/POST/DELETE for the app_data key-value table
  storage/[key].js         Per-key handler (used by `db` when VITE_STORAGE_BACKEND=api)
  liquidity/simulate.js    Server-side liquidity simulator with Postgres-backed cache
                           (5,000 runs default; cache key includes scenario, claims sig, prevalence)
  _lib/storage-handler.js  Shared storage helpers (getOne, setOne, parseBody, StorageError)

db/
  schema.js                Drizzle schema for the app_data key-value table
  client.js                Drizzle/Neon client factory

public/data/               Frozen demo JSONs + CSV templates (Templates 1, 2, 3 from spec)
public/migrate.html        One-shot localStorage → Postgres migration tool
scripts/
  generate-demo-claims.mjs Seeded regeneration of demo_*_claims.json
  api-server.mjs           Local Node HTTP harness for api/* (used by api:serve / api:test)
  api-test.mjs             Scripted HTTP smoke against the local harness
  db-smoke.mjs             Direct Postgres round-trip smoke against api/_lib/storage-handler
tests/
  ui-smoke.spec.js         Playwright e2e — Cases → MRL completion, both stochastic modes, /migrate.html
docs/                      Authoritative spec docs (Master Spec v3.3, Liquidity Spec v1.2, etc.)
drizzle.config.js          Drizzle Kit config — schema source + dialect for `db:push`
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

---

## 15. Dependency security posture

The runtime tree (everything in `dependencies` + their transitive packages) is what ships to the browser bundle and to Vercel Functions. As of the latest commit, that tree is five top-level packages — `react`, `react-dom`, `lucide-react`, `papaparse`, `drizzle-orm`, `@neondatabase/serverless` — and 50-ish transitive deps, none currently flagged.

Dependabot alerts on this repo are scoped to `devDependencies` only. The vulnerable packages all trace back to `vercel` (the local CLI used for `vercel dev` and `vercel env pull`) or `drizzle-kit` (the schema-management CLI). Specifically: `tar`, `undici`, `minimatch`, `srvx`, `@tootallnate/once`, `esbuild`, and `@esbuild-kit/*` are all transitive deps of those two CLIs and never reach the deployed app.

Confirm the runtime tree is clean before any release:

```bash
npm ls --omit=dev --all          # lists exactly what ships
npm audit --omit=dev             # audit only runtime deps
```

If a Dependabot alert ever lands on a package that appears in `npm ls --omit=dev`, that's a real security finding and must be addressed before the next deploy. Dev-tooling alerts can be dismissed with reason "Vulnerable code is not actually used" (the vulnerable code path is local-CLI-only, not exposed to user input or to production).
