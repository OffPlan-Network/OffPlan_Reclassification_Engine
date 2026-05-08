// One-shot generator that emits frozen synthetic claim files for each demo
// case. Re-run with `npm run gen-demo` to regenerate. Output JSON lives in
// public/data/ and is fetched at runtime by demo cases with loader kind
// `json_full`. Using a seeded RNG ensures the demo numbers are reproducible
// across browsers, sessions, and machines.

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { generateSyntheticClaims } from '../src/engine/synthetic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA = resolve(__dirname, '..', 'public', 'data');

// mulberry32 — small, fast, deterministic PRNG.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = orig; }
}

const cases = [
  {
    out: 'demo_abc_manufacturing_claims.json',
    employerId: 'DEMO_ABC',
    state: 'GA',
    lives: 162,
    spend: 950000,
    seed: 0xABCD,
  },
  {
    out: 'demo_riverdale_hospitality_claims.json',
    employerId: 'DEMO_RHG',
    state: 'TX',
    lives: 205,
    spend: 1080000,
    seed: 0xFACE,
  },
];

for (const c of cases) {
  const result = withSeed(c.seed, () => generateSyntheticClaims(c.lives, c.spend));

  // Same enrichment App.jsx applies at runtime for synthetic_full demos.
  // chronic_flag is stamped by the generator (top utilization-weight quantile)
  // and the spread preserves it; no post-hoc heuristic override.
  const enriched = result.claims.map((claim, i) => ({
    ...claim,
    employer_id: c.employerId,
    employee_id: `E${String((i % Math.max(2, Math.floor(c.lives / 1.6))) + 1).padStart(4, '0')}`,
    member_relationship: i % 3 === 0 ? 'spouse' : i % 5 === 0 ? 'child' : 'employee',
    member_age: 25 + ((i * 7) % 45),
    member_gender: i % 2 === 0 ? 'M' : 'F',
    state: c.state,
  }));

  const total = enriched.reduce((s, x) => s + (Number(x.allowed_amount) || 0), 0);
  const path = resolve(PUBLIC_DATA, c.out);
  writeFileSync(path, JSON.stringify(enriched, null, 2));
  console.log(
    `${c.out.padEnd(45)} ${enriched.length.toString().padStart(5)} claims · target $${c.spend.toLocaleString().padStart(9)} · actual $${Math.round(total).toLocaleString().padStart(9)} · drift ${(((total - c.spend) / c.spend) * 100).toFixed(1)}%`
  );
}
