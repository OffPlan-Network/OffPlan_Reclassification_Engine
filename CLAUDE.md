# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (HMR).
- `npm run build` — production build to `dist/` (sourcemaps on). Deployed by Vercel via its GitHub integration on push to `master`/`main`.
- `npm run preview` — serve the built `dist/` locally.
- `npm run gen-demo` — regenerate the frozen demo claim JSON files in `public/data/`. Run this after changing `src/engine/synthetic.js` or `scripts/generate-demo-claims.mjs`; otherwise the deterministic Mode 1 demos (ABC Manufacturing, Riverdale Hospitality) will drift from the synthetic generator's current output.

There are no tests, no linter, and no typechecker configured.

## Architecture

Single-page React 18 + Vite app that demonstrates a five-stage claims-reclassification cascade. The app is purely client-side — no backend, no API. All persistence is `localStorage` (with an in-memory fallback for sandboxed contexts).

### State & persistence

`src/App.jsx` is the single source of truth. It owns every piece of state and passes data + callbacks down to screen components. Persistence goes through `src/storage.js` (`db` object, async API, namespaced under `offplan_engine:`):

- `employer:<id>` — employer profile
- `claims:<id>` — that employer's classified claim lines
- `scenario:<id>` — active scenario knobs
- `input_mode:<id>` — provenance for how claims were ingested
- `global:pricing_versions`, `global:rule_versions`, `global:indemnity_versions`, `global:benchmark_versions` — versioned admin tables (cut as new immutable rows; previous rows flip to `archived`)
- `global:audit_log` — capped at 500 entries, prepended

Switching employers calls `loadEmployer(id)` which rehydrates all of the above into React state. There is no Redux/Zustand/Context — drilling props is intentional.

### The cascade (`src/engine/calculate.js`)

Order is mandatory and load-bearing — do not reorder:

1. **Bucket transform.** Per-claim modeled cost computed from the bucket: A (DPC eliminated %), B (cash price lookup, else `repriceFactors[category]`, else scenario default; Urgent Care gets an extra reduction), C (ER % reduction), E (catastrophic, full allowed), D (residual default).
2. **Indemnity offset.** Walks claims in modeled-cost-descending order, applying per-member-per-event-type benefit caps from `indemnityBenefits`.
3. **Stop-loss split.** Aggregates per-`member_id` *first*, then drains the overage from that member's largest claims down. Member-level aggregation is the whole point — splitting per claim would understate stop-loss attachment.
4. **Residual.** Whatever's left on each claim.

Excluded claims (`c.excluded === true`) are dropped before any of this — they don't appear in `historical_claims` or any aggregate.

### Classification (`src/engine/classify.js`)

`normalizeAndClassify(claim, cptRules)` resolves to a bucket via this precedence: DRG/POS=Inpatient → POS=ER → POS=Urgent → POS=ASC (then CPT) → CPT range match (with specialty override that bumps Primary Care into Specialist Consult when specialty is non-PCP) → Rx claim_type → Other (bucket D, low confidence).

CPT ranges are string comparisons, not numeric — they intentionally support alphanumeric HCPCS codes like `G0438`.

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

### Screens

`src/screens/` — one component per route. `SCREENS` enum in `src/screens/index.js`. Navigation is state in `App.jsx` (`screen` + `setScreen`); there is no router. Order in the typical flow: Cases → Setup → Upload → Classify → Scenario → Dashboard → Report. Admin is the side door.

### Styling

Tailwind via CDN (`<script src="https://cdn.tailwindcss.com">` in `index.html`) — there is no Tailwind build step, no `tailwind.config.js`. The TODO in `index.html` notes the intent to migrate to Tailwind v4 once the design stabilizes. `src/styles/main.css` is minimal.

## Legacy / non-source files

The repo root contains pre-refactor reference artifacts that are **not** part of the build:

- `05_OffPlan_Engine_Reference_Implementation.jsx` (~3.4k lines) — the original monolithic Claude-Artifact-era component, preserved for reference.
- `OffPlan_Engine_Build_Package_v1_0_FINAL (1).zip` — original spec bundle.
- `docs/` — Word specification documents (Master Spec v33, Data Dictionary, Architecture Spec, etc.).

Do not edit these expecting them to affect the running app. The Vite app only consumes `src/`, `public/`, and `index.html`.
