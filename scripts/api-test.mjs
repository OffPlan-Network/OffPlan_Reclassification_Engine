// HTTP-level smoke test for the /api/storage/* route files. Boots the
// local api-server.mjs in a child process, hits every route via fetch,
// and tears the server down. Catches dispatch / parsing / encoding bugs
// that the handler-level smoke (db-smoke.mjs) can't see.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const PORT = 4001;
const BASE = `http://localhost:${PORT}`;
const PREFIX = 'api_smoke:';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('  ok  -', msg);
}

async function jget(path)         { return (await fetch(BASE + path)).json(); }
async function jput(path, body)   { return (await fetch(BASE + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
async function jpost(path, body)  { return (await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
async function jdelete(path)      { return (await fetch(BASE + path, { method: 'DELETE' })).json(); }

async function waitReady(ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/api/storage?prefix=__never__');
      if (r.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error('api-server did not come up within ' + ms + 'ms');
}

const server = spawn(
  process.execPath,
  ['--env-file=.env.local', 'scripts/api-server.mjs'],
  { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, API_PORT: String(PORT) } },
);

let cleanupRan = false;
async function cleanup() {
  if (cleanupRan) return;
  cleanupRan = true;
  // Best-effort wipe of any rows we left behind, then kill the server.
  try {
    const { keys = [] } = await jget(`/api/storage?prefix=${encodeURIComponent(PREFIX)}`);
    await Promise.all(keys.map((k) => jdelete(`/api/storage/${encodeURIComponent(k)}`)));
  } catch {}
  server.kill('SIGTERM');
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });

try {
  await waitReady();
  console.log('[1/5] PUT /api/storage/<key> persists a value');
  const k1 = PREFIX + 'employer:DEMO_API';
  await jput(`/api/storage/${encodeURIComponent(k1)}`, { value: { id: 'DEMO_API', name: 'API smoke' } });
  const got = await jget(`/api/storage/${encodeURIComponent(k1)}`);
  assert(got.value && got.value.id === 'DEMO_API', 'GET returns the value PUT just wrote');

  console.log('[2/5] GET /api/storage?prefix= lists keys');
  const list = await jget(`/api/storage?prefix=${encodeURIComponent(PREFIX)}`);
  assert(Array.isArray(list.keys) && list.keys.includes(k1), 'list response includes our key');

  console.log('[3/5] POST /api/storage upserts via collection route');
  const k2 = PREFIX + 'claims:DEMO_API';
  const post = await jpost('/api/storage', { key: k2, value: [{ claim_id: 'c1', allowed_amount: 42 }] });
  assert(post.ok === true, 'POST returns ok:true');
  const got2 = await jget(`/api/storage/${encodeURIComponent(k2)}`);
  assert(Array.isArray(got2.value) && got2.value[0].allowed_amount === 42, 'value round-trips correctly through POST');

  console.log('[4/5] PUT overwrites');
  await jput(`/api/storage/${encodeURIComponent(k1)}`, { value: { id: 'DEMO_API', name: 'API smoke v2' } });
  const got3 = await jget(`/api/storage/${encodeURIComponent(k1)}`);
  assert(got3.value.name === 'API smoke v2', 'second PUT replaces the value');

  console.log('[5/5] DELETE removes the row');
  await jdelete(`/api/storage/${encodeURIComponent(k1)}`);
  const got4 = await jget(`/api/storage/${encodeURIComponent(k1)}`);
  assert(got4.value === null, 'GET returns null after DELETE');

  console.log('\nAll API smoke checks passed.');
} catch (err) {
  console.error('Smoke run failed:', err.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
