# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (HMR), localStorage backend.
- `npm run dev:vercel` — `vercel dev` on port 3000: Vite + the `/api/*` Vercel Functions, hits Neon Postgres via Drizzle. Use when working on API code or testing the Postgres-backed flow end-to-end.
- `npm run build` — production build to `dist/` (sourcemaps on). Deployed by Vercel via its GitHub integration on push to `master`/`main`. The `/api/*` directory is auto-deployed as Serverless Functions alongside the SPA.
- `npm run preview` — serve the built `dist/` locally.
- `npm run gen-demo` — regenerate the frozen demo claim JSON files in `public/data/`. Run this after changing `src/engine/synthetic.js` or `scripts/generate-demo-claims.mjs`; otherwise the deterministic Mode 1 demos (ABC Manufacturing, Riverdale Hospitality) will drift from the synthetic generator's current output.
- `npm run db:push` — apply Drizzle schema (`db/schema.js`) to the configured Neon database (DDL).
- `npm run db:studio` — open Drizzle Studio against Neon for ad-hoc inspection.
- `npm run db:smoke` — exercise the storage handlers (`api/_lib/storage-handler.js`) against Neon directly without going through HTTP.
- `npm run api:serve` — spawn a local Node HTTP harness (`scripts/api-server.mjs`) that serves the `api/*` handlers without `vercel dev`. Cheaper iteration loop for backend-only changes.
- `npm run api:test` — start the harness and run a scripted HTTP smoke (`scripts/api-test.mjs`). Tests storage round-trips and the `/api/liquidity/simulate` cache path.
- `npm run test:e2e` — Playwright UI smoke (`tests/ui-smoke.spec.js`) against `vercel dev`. Covers Cases load, Setup, Upload, both stochastic modes, and the `/migrate.html` flow.

There is no linter and no typechecker configured. The Playwright suite is the only automated test.

## Architecture

Single-page React 18 + Vite app implementing a five-stage deterministic claims cascade plus a two-mode Monte Carlo stochastic capital layer. There is a backend: Vercel Functions in `api/` provide a Postgres-backed storage layer and a server-side liquidity simulator with caching.

### State & persistence

`src/App.jsx` is the single source of truth. It owns every piece of state and passes data + callbacks down to screen components. There is no Redux/Zustand/Context — drilling props is intentional.

Persistence goes through `src/storage.js` (`db` object, async API). Two backends are wired through the same interface, switched by `VITE_STORAGE_BACKEND` in `.env.local`:

- `localStorage` (default) — namespaced under `offplan_engine:`, with an in-memory fallback for sandboxed contexts.
- `api` — reads/writes go to `/api/storage/*` (Vercel Functions over Neon Postgres via Drizzle). The migration tool at `/migrate.html` does a one-shot localStorage → Postgres copy.

Storage keys (same shape under both backends):

- `employer:<id>` — employer profile (now includes `chronic_prevalence` and `chronic_prevalence_source` after the first claims ingestion)
- `claims:<id>` — that employer's classified claim lines
- `scenario:<id>` — active scenario knobs
- `input_mode:<id>` — provenance for how claims were ingested
- `liquidity_cache:<version>:<employer>:<scenarioHash>:<claimsSig>:<mode>:p=<prevalence>:<runs>` — server-side liquidity simulator results, written by `/api/liquidity/simulate`. Bump `CACHE_VERSION` in that file when simulator semantics change to invalidate.
- `global:pricing_versions`, `global:rule_versions`, `global:indemnity_versions`, `global:benchmark_versions` — versioned admin tables (cut as new immutable rows; previous rows flip to `archived`)
- `global:audit_log` — capped at 500 entries, prepended

Switching employers calls `loadEmployer(id)` which rehydrates all of the above into React state.

### The cascade (`src/engine/calculate.js`)

Order is mandatory and load-bearing — do not reorder:

1. **Bucket transform.** Per-claim modeled cost computed from the bucket: A (DPC eliminated %), B (cash price lookup, else `repriceFactors[category]`, else scenario default; Urgent Care gets an extra reduction), C (ER % reduction), E (catastrophic, full allowed), D (residual default).
2. **Indemnity offset.** Walks claims in modeled-cost-descending order, applying per-member-per-event-type benefit caps from `indemnityBenefits`.
3. **Stop-loss split.** Aggregates per-`member_id` *first*, then drains the overage from that member's largest claims down. Member-level aggregation is the whole point — splitting per claim would understate stop-loss attachment.
4. **Residual.** Whatever's left on each claim.

Excluded claims (`c.excluded === true`) are dropped before any of this — they don't appear in `historical_claims` or any aggregate.

### OffPlan cost stack (`src/constants.js` + `DashboardScreen.jsx` / `ReportScreen.jsx`)

The engine produces the cascade aggregates above; the screens layer the OffPlan cost stack on top to render Total OffPlan PEPM. The stack constants are anchored to **`docs/OffPlan_Financial_Model_Assumptions_Reference.docx` (Source of Truth, May 2026)**:

```
OFFPLAN_FIXED_OVERHEAD_PEPM = 282.20  (sum of the six fixed components)
  OFFPLAN_MEMBERSHIP_PEPM      $185.00   locked (doc §1)
  PBM_ADMIN_PEPM               $  8.00   working assumption — finalize w/ Yuzu PBM RFP
  FIRSTHEALTH_PEPM             $  5.95   confirmed — Yuzu rate card
  MEDWATCH_PEPM                $  3.25   confirmed — Yuzu rate card
  ACCIDENT_INDEMNITY_PEPM      $ 40.00   working assumption — finalize w/ TownHealth or equivalent
  TPA_PEPM                     $ 40.00   confirmed — Yuzu

Total OffPlan PEPM =
    OFFPLAN_FIXED_OVERHEAD_PEPM
  + scenario.stop_loss_pepm                ($85 / $100 / $130 by preset)
  + (residual_pepm × scenario.risk_margin) (deprecated v3.0/v3.1 placeholder; doc §3 anchors the long-run replacement at $200 PMPM)
```

When any of these constants change, also update the README's §6 stack box, §8 ABC walkthrough, §8.5 calibration history, and §9 scenario knobs table. The Report screen renders one row per stack component — keep its rows in sync with `src/constants.js`. The `OFFPLAN_FIXED_OVERHEAD_PEPM` constant is derived; do not hardcode `282.20` anywhere.

### Classification (`src/engine/classify.js`)

`normalizeAndClassify(claim, cptRules)` resolves to a bucket via this precedence: DRG/POS=Inpatient → POS=ER → POS=Urgent → POS=ASC (then CPT) → CPT range match (with specialty override that bumps Primary Care into Specialist Consult when specialty is non-PCP) → Rx claim_type → Other (bucket D, low confidence).

CPT ranges are string comparisons, not numeric — they intentionally support alphanumeric HCPCS codes like `G0438`.

### Stochastic liquidity layer (`src/engine/stochastic.js`)

Monte Carlo simulator that sizes Min Required Liquidity (MRL) under the OffPlan funding model. Two modes, both pure functions (run unchanged in the browser or in a Vercel Function):

- **`timing-resample`** (default) — resamples each deterministic claim onto a uniform-random month and adds a Pareto catastrophic-event tail overlay. Calibrated by construction to the deterministic engine's `residual_fund`. Use as the primary number for CFO conversations.
- **`tier-generated`** (v3) — generates events fresh per run from the 11-tier `EVENT_TIER_CATALOG` (Poisson or NegBin frequency × log-normal or Pareto cost), runs them through the full member-aggregating cascade (per-event reduction → indemnity offset → member-aggregate stop-loss → aggregate corridor), and reports a calibration `drift_pct` vs the deterministic residual.

Tier-generated mode also models:

- **Complications** — tiers 5–9 roll for a follow-on event on the same member with log-normal lag; depth-capped at 3.
- **Chronic clustering** — at run start, a fraction (`CHRONIC_PREVALENCE = 0.28` by default, or `employer.chronic_prevalence` override) of member IDs are flagged chronic. Per-tier events are drawn from a chronic pool at λ × `effective_uplift` and a non-chronic pool at λ. Repeated draws on the smaller chronic pool concentrate events on the same members. `CHRONIC_TIER_UPLIFT` in `src/constants.js` defines per-tier uplift; tiers omitted there default to 1× (no clustering).
- **DPC clinical mitigation** — both complication probability and chronic uplift are scaled by `(1 − scenario.dpc_clinical_mitigation_pct)`. Single knob (0.20 / 0.30 / 0.45 across the three presets) capturing DPC's clinical effect: monthly-membership primary care absorbs chronic management and catches complication early-warnings.

**Stop-loss claim payment spread** (both modes) — claims/events with `stop_loss_amount > 0` spread their cash outflow `1/3 / 1/3 / 1/3` across three months instead of hitting fully in the month of service. Models real-world hospital adjudication delay + invoice terms (typically net-30 / net-60). `STOP_LOSS_PAYMENT_SCHEDULE` in `src/constants.js` is the default; override via `options.stopLossPaymentSchedule = [1]` to disable for sensitivity testing. Stop-loss carrier reimbursement timing is unchanged — still arrives at month + lagMonths from claim incident. Smaller cash-pay claims settle same-month. Effect on MRL: 30–45% reduction on catastrophic-heavy populations vs the single-month treatment.

Result includes bootstrap 95% CIs on every reported percentile (P50/P75/P90/P95/P99) computed via a 500-resample bootstrap with a derived seed. The tail overlay in timing-resample mode is **not** mitigated by DPC — it represents truly catastrophic events where DPC's preventive leverage is weak.

Determinism: every random draw goes through a mulberry32 PRNG seeded by FNV-1a hash of `(employer.id, scenario.name, runs, lagMonths, attachmentPoint, prevalence)`. Same inputs → identical output. Bootstrap CIs use a derived seed (main_seed XOR `0xb007517a`) so they're stable too.

### Calibration (`src/engine/calibration.js`)

`estimateChronicPrevalence(classifiedClaims)` returns the share of unique members with at least one Bucket E event or > $5K of cumulative non-Bucket-A spend. Returns `null` when input is empty.

Auto-calibration runs in `App.jsx → ingestClaims()` after every successful classification. It stamps `employer.chronic_prevalence` + `chronic_prevalence_source: 'auto'` unless the user has set `chronic_prevalence_source: 'manual'` via SetupScreen, in which case it leaves the value alone. The stochastic engine reads `employer.chronic_prevalence` and falls back to `CHRONIC_PREVALENCE` (the population default) when unset or out of range.

### Three input modes (`INPUT_MODES` in `src/constants.js`)

The app accepts claims at three confidence levels:

- **Full (Mode 1)** — member-level CPT lines. High confidence.
- **Partial (Mode 2)** — category totals only. `decomposePartialSummary()` in `src/engine/synthetic.js` fans them out into representative claim lines using the same `SYNTHETIC_DISTRIBUTION` table the generator uses, so downstream code can treat all three modes uniformly. Confidence downgrades to medium.
- **Modeled (Mode 3)** — no claims access; `generateSyntheticClaims()` builds a benchmark-scaled dataset from covered lives + annual spend. Low confidence. The generator is hard-capped at 20,000 claims (`MAX_SYNTHETIC_CLAIMS`) to protect the browser.

Provenance fields (`input_mode`, `data_source`, `confidence_level`, `assumption_source`, `*_version_id`) are stamped onto every claim at ingestion in `App.jsx → ingestClaims()`. Downstream UI (BucketBadge, Provenance, Dashboard, Report) reads these fields to render confidence chips and version footers.

### Demo cases (`src/demo-cases.js`)

Loader kinds and how `App.jsx → loadDemoCase()` handles them:

- `json_full` — fetches a frozen JSON file from `public/data/`. Deterministic across loads. Used for ABC Manufacturing and Riverdale Hospitality.
- `synthetic_full` — runs `generateSyntheticClaims()` at runtime. Non-deterministic (`Math.random()`).
- `csv_partial` — fetches a CSV from `public/data/`, parses with PapaParse, runs `decomposePartialSummary()`.
- `rows_partial` — inline rows array, also runs `decomposePartialSummary()`.
- `modeled` — Mode 3 path; runs the generator and stamps `mode: "modeled"`.

The frozen JSONs in `public/data/demo_*_claims.json` are produced by `scripts/generate-demo-claims.mjs` using a seeded mulberry32 PRNG that temporarily replaces `Math.random` while the generator runs. Editing the synthetic generator without re-running `npm run gen-demo` causes the live `synthetic_full` path and the frozen `json_full` path to disagree.

### Versioning & audit

Admin edits to cash prices, indemnity benefits, or repricing factors don't mutate in place — they call `cutNewVersion()`, which archives the prior `active` row and prepends a new one. Every change is also written to the audit log via `writeAudit()`. Newly ingested claims are stamped with the IDs of the currently active versions, so a report regenerated months later can still resolve the exact pricing that produced its numbers.

### API + database backend

The `api/` directory is auto-deployed by Vercel as Serverless Functions. Same handlers also run under `npm run api:serve` for local backend-only iteration.

- `api/storage/index.js` and `api/storage/[key].js` — generic key-value handlers backing the `api` storage backend. Read/write namespaced under the `app_data` table in Postgres.
- `api/liquidity/simulate.js` — POST endpoint. Pulls claims + employer record from storage, re-runs the deterministic cascade, runs `simulateLiquidity()` server-side at 5,000 runs (vs the client default of 1,000), and caches the result keyed by scenario hash + claims fingerprint + chronic prevalence + run count. `force: true` in the body bypasses the cache. Bump `CACHE_VERSION` in this file when simulator semantics change so old entries get re-keyed instead of misread.
- `api/_lib/storage-handler.js` — shared Postgres storage helpers (`getOne`, `setOne`, `parseBody`, `StorageError`).

Database layer:

- `db/schema.js` — Drizzle schema for the `app_data` key-value table (single table; the JSON blob does the schema work).
- `db/client.js` — Drizzle/Neon client factory.
- `drizzle.config.js` — schema source + dialect for `drizzle-kit push`.

Client-side liquidity is fetched via `src/hooks/useLiquidity.js`. The hook switches between `simulateLiquidity()` inline (when `VITE_STORAGE_BACKEND !== 'api'`) and a POST to `/api/liquidity/simulate` (when set to `api`). Its fingerprint includes `employer.chronic_prevalence` so chronic-prevalence overrides invalidate cached results.

### Screens & hooks

`src/screens/` — one component per route. `SCREENS` enum in `src/screens/index.js`. Navigation is state in `App.jsx` (`screen` + `setScreen`); there is no router. Order in the typical flow: Cases → Setup → Upload → Classify → Scenario → Dashboard → Report. Admin is the side door.

`src/hooks/useLiquidity.js` is currently the only hook. It owns the liquidity-fetch state machine (idle / loading / local / api), automatic re-fetch on input change, and stale-response guarding via an in-flight fingerprint ref.

### Styling

Tailwind via CDN (`<script src="https://cdn.tailwindcss.com">` in `index.html`) — there is no Tailwind build step, no `tailwind.config.js`. The TODO in `index.html` notes the intent to migrate to Tailwind v4 once the design stabilizes. `src/styles/main.css` is minimal.

### Tests

`tests/ui-smoke.spec.js` is the only automated test — a Playwright e2e smoke that runs against `vercel dev`. It covers the happy-path flow (Cases → MRL card finishes computing), the timing-resample / tier-generated mode toggle, the calibration drift label, and the localStorage → Postgres migration tool at `/migrate.html`. Assertions target structural elements and key text labels; explanatory copy is intentionally not asserted on, so doc/banner tweaks don't break the suite.

Run with `npm run test:e2e` (headless) or `npm run test:e2e:headed` (visible browser).

## Legacy / non-source files

The repo root contains pre-refactor reference artifacts that are **not** part of the build:

- `05_OffPlan_Engine_Reference_Implementation.jsx` (~3.4k lines) — the original monolithic Claude-Artifact-era component, preserved for reference.
- `OffPlan_Engine_Build_Package_v1_0_FINAL (1).zip` — original spec bundle.
- `docs/` — Word specification documents (Master Spec v33, Data Dictionary, Architecture Spec, etc.). One exception: `docs/OffPlan_Financial_Model_Assumptions_Reference.docx` is the active Source-of-Truth pricing doc — the stack constants in `src/constants.js` and the demo-case `current_total_healthcare_spend` numbers in `src/demo-cases.js` are pinned to it. When that doc updates, those constants and downstream README sections must update to match.

Do not edit these expecting them to affect the running app. The Vite app only consumes `src/`, `public/`, and `index.html`.
