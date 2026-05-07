// Shared business logic for the /api/storage routes. Keeping this in
// api/_lib means each route file is a thin Vercel-Function wrapper that
// dispatches by HTTP method and translates query params, while the actual
// db work lives in one place.
//
// The exported functions return plain JSON-serializable values and throw
// on validation errors; the route wrappers turn those into HTTP responses.

import { eq, like, asc } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';

const { appData } = schema;

export class StorageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Neon's free/scale-to-zero compute autosuspends after idle. The first
// request after a cold-start can fail with `fetch failed` before the
// compute is back up. One retry with a short delay absorbs this without
// papering over real failures (which still surface on the second attempt).
async function withColdStartRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err?.cause?.code || err?.cause?.message || err?.message || '');
    const isTransient = /fetch failed|ECONNRESET|ETIMEDOUT|ENETUNREACH|aborted/i.test(msg);
    if (!isTransient) throw err;
    await new Promise((r) => setTimeout(r, 750));
    return await fn();
  }
}

export async function getOne(key) {
  if (!key || typeof key !== 'string') {
    throw new StorageError(400, 'key is required');
  }
  return withColdStartRetry(async () => {
    const rows = await db
      .select({ value: appData.value })
      .from(appData)
      .where(eq(appData.key, key))
      .limit(1);
    return rows.length ? rows[0].value : null;
  });
}

export async function setOne(key, value) {
  if (!key || typeof key !== 'string') {
    throw new StorageError(400, 'key is required');
  }
  if (value === undefined) {
    throw new StorageError(400, 'value is required');
  }
  await withColdStartRetry(async () => {
    await db
      .insert(appData)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appData.key,
        set: { value, updatedAt: new Date() },
      });
  });
  return { ok: true };
}

export async function deleteOne(key) {
  if (!key || typeof key !== 'string') {
    throw new StorageError(400, 'key is required');
  }
  await withColdStartRetry(async () => {
    await db.delete(appData).where(eq(appData.key, key));
  });
  return { ok: true };
}

export async function listKeys(prefix) {
  const safe = typeof prefix === 'string' ? prefix : '';
  // Postgres LIKE wildcards: % matches any sequence. The text_pattern_ops
  // index makes left-anchored prefix scans efficient.
  const pattern = safe.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return withColdStartRetry(async () => {
    const rows = await db
      .select({ key: appData.key })
      .from(appData)
      .where(like(appData.key, pattern))
      .orderBy(asc(appData.key));
    return rows.map((r) => r.key);
  });
}

export async function clearAll() {
  await withColdStartRetry(async () => {
    await db.delete(appData);
  });
  return { ok: true };
}

// Tiny helper used by the route wrappers — Vercel's default `req.body`
// parsing handles JSON, but we defensively coerce string bodies (some
// clients post raw JSON without setting Content-Type).
export function parseBody(req) {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new StorageError(400, 'invalid JSON body'); }
  }
  return b;
}
