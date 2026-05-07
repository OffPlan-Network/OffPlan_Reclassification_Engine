// Backend-swappable storage layer. The public `db` interface is unchanged
// from the original localStorage-only version — every consumer in the app
// continues to call db.get/set/list/delete/clearAll without knowing which
// backend is in play.
//
// Backends:
//   - localStorageBackend (default): namespaced reads/writes against
//     window.localStorage, with an in-memory fallback for sandboxed contexts
//     (private windows, some embedded webviews).
//   - apiBackend: fetches /api/storage/*. Used when VITE_STORAGE_BACKEND=api.
//     Requires the Vercel Functions to be reachable — locally that means
//     running `vercel dev` instead of `vite` so /api/* is served alongside
//     the SPA.
//
// Selection happens once at module load; flipping the env var requires a
// rebuild of the Vite bundle.

const NAMESPACE = 'offplan_engine:';

// -----------------------------------------------------------------------------
// localStorage backend (the original behavior)
// -----------------------------------------------------------------------------

function makeLocalStorageBackend() {
  const memStore = {};
  let hasLocalStorage = false;
  try {
    const probe = NAMESPACE + '__probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    hasLocalStorage = true;
  } catch {
    hasLocalStorage = false;
  }

  const ns = (key) => NAMESPACE + key;

  return {
    name: 'localStorage',
    isPersistent: () => hasLocalStorage,
    async get(key) {
      try {
        const v = hasLocalStorage
          ? window.localStorage.getItem(ns(key))
          : memStore[key];
        if (v === null || v === undefined) return null;
        return JSON.parse(v);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        const json = JSON.stringify(value);
        if (hasLocalStorage) window.localStorage.setItem(ns(key), json);
        else memStore[key] = json;
        return true;
      } catch {
        return false;
      }
    },
    async delete(key) {
      try {
        if (hasLocalStorage) window.localStorage.removeItem(ns(key));
        delete memStore[key];
        return true;
      } catch {
        return false;
      }
    },
    async list(prefix) {
      const safe = typeof prefix === 'string' ? prefix : '';
      try {
        if (hasLocalStorage) {
          const full = ns(safe);
          const out = [];
          const len = window.localStorage.length || 0;
          for (let i = 0; i < len; i++) {
            const k = window.localStorage.key(i);
            if (typeof k === 'string' && k.indexOf(full) === 0) {
              out.push(k.slice(NAMESPACE.length));
            }
          }
          return out;
        }
        return Object.keys(memStore).filter((k) => k.indexOf(safe) === 0);
      } catch {
        return [];
      }
    },
    async clearAll() {
      try {
        if (hasLocalStorage) {
          const toRemove = [];
          const len = window.localStorage.length || 0;
          for (let i = 0; i < len; i++) {
            const k = window.localStorage.key(i);
            if (typeof k === 'string' && k.indexOf(NAMESPACE) === 0) toRemove.push(k);
          }
          for (const k of toRemove) window.localStorage.removeItem(k);
        }
        Object.keys(memStore).forEach((k) => { delete memStore[k]; });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// -----------------------------------------------------------------------------
// API backend — talks to the Vercel Functions in /api/storage/*
// -----------------------------------------------------------------------------

function makeApiBackend() {
  const enc = (k) => encodeURIComponent(k);

  async function fetchJSON(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) {
      // Return null/false rather than throwing — matches the resilience
      // contract the rest of the app relies on (storage failures are soft).
      console.warn('[storage:api] request failed', res.status, url);
      return { ok: false, status: res.status };
    }
    return { ok: true, body: await res.json() };
  }

  return {
    name: 'api',
    isPersistent: () => true,
    async get(key) {
      const r = await fetchJSON(`/api/storage/${enc(key)}`);
      if (!r.ok) return null;
      return r.body && Object.prototype.hasOwnProperty.call(r.body, 'value') ? r.body.value : null;
    },
    async set(key, value) {
      const r = await fetchJSON(`/api/storage/${enc(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      return r.ok;
    },
    async delete(key) {
      const r = await fetchJSON(`/api/storage/${enc(key)}`, { method: 'DELETE' });
      return r.ok;
    },
    async list(prefix) {
      const safe = typeof prefix === 'string' ? prefix : '';
      const r = await fetchJSON(`/api/storage?prefix=${enc(safe)}`);
      if (!r.ok) return [];
      return Array.isArray(r.body?.keys) ? r.body.keys : [];
    },
    async clearAll() {
      const r = await fetchJSON('/api/storage?confirm=yes', { method: 'DELETE' });
      return r.ok;
    },
  };
}

// -----------------------------------------------------------------------------
// Backend selection
// -----------------------------------------------------------------------------

const BACKEND_ENV = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STORAGE_BACKEND) || 'localStorage';

const backend =
  BACKEND_ENV === 'api' ? makeApiBackend() : makeLocalStorageBackend();

// Public surface — kept identical to the pre-refactor shape so no caller
// in App.jsx or the screen components needs to change.
export const db = {
  list: (prefix) => backend.list(prefix),
  get: (key) => backend.get(key),
  set: (key, value) => backend.set(key, value),
  delete: (key) => backend.delete(key),
  clearAll: () => backend.clearAll(),
  isPersistent: () => backend.isPersistent(),
  // Exposed for diagnostics (e.g., a debug banner showing which backend is live).
  backendName: () => backend.name,
};
