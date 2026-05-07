// End-to-end smoke test for the Drizzle + Neon storage stack. Exercises
// every operation the app uses through the same handler functions the API
// routes call, so a green run here is a strong signal that the storage
// layer is wired correctly before we point the UI at it.
//
// Usage: npm run db:smoke
//
// Cleans up after itself — every key it writes uses the smoke: prefix
// and is deleted on exit.
//
// Env loading: the npm script runs node with --env-file=.env.local so
// DATABASE_URL is set before any ESM import evaluates.

import {
  getOne,
  setOne,
  deleteOne,
  listKeys,
} from '../api/_lib/storage-handler.js';

const PREFIX = 'smoke:';
const fixtures = [
  { key: PREFIX + 'employer:DEMO_TEST', value: { id: 'DEMO_TEST', name: 'Smoke Test Co.', covered_lives: 50 } },
  { key: PREFIX + 'claims:DEMO_TEST',  value: [{ claim_id: 'c1', allowed_amount: 100 }] },
  { key: PREFIX + 'scenario:DEMO_TEST', value: { name: 'Expected', stop_loss_pepm: 100 } },
];

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok  -', msg);
}

async function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  console.log('[1/6] empty list returns no smoke keys');
  const initial = await listKeys(PREFIX);
  assert(initial.length === 0, `pre-test cleanup left ${initial.length} smoke keys behind — clean Neon manually`);

  console.log('[2/6] setOne writes round-trip');
  for (const f of fixtures) await setOne(f.key, f.value);
  for (const f of fixtures) {
    const got = await getOne(f.key);
    assert(await deepEqual(got, f.value), `getOne(${f.key}) returned the value we wrote`);
  }

  console.log('[3/6] listKeys with prefix returns all smoke keys');
  const all = await listKeys(PREFIX);
  assert(all.length === fixtures.length, `listKeys returned ${all.length} keys (expected ${fixtures.length})`);
  for (const f of fixtures) {
    assert(all.includes(f.key), `listKeys included ${f.key}`);
  }

  console.log('[4/6] listKeys with narrower prefix filters correctly');
  const narrow = await listKeys(PREFIX + 'employer:');
  assert(narrow.length === 1 && narrow[0].endsWith('employer:DEMO_TEST'), 'employer:-prefixed list returns just the employer row');

  console.log('[5/6] setOne upserts on conflict');
  await setOne(fixtures[0].key, { ...fixtures[0].value, name: 'Smoke Test Co. (updated)' });
  const updated = await getOne(fixtures[0].key);
  assert(updated.name === 'Smoke Test Co. (updated)', 'second write to the same key updates the row');

  console.log('[6/6] deleteOne removes the row');
  for (const f of fixtures) await deleteOne(f.key);
  const after = await listKeys(PREFIX);
  assert(after.length === 0, `all smoke keys deleted (${after.length} remaining)`);

  console.log('\nAll storage smoke checks passed.');
}

main().catch((err) => {
  console.error('Smoke test exploded:', err);
  process.exit(1);
});
