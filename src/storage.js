// Namespaced wrapper over localStorage with an in-memory fallback for
// sandboxed/private contexts. Replaces the Claude-Artifact-era window.storage
// shim — module scope means we no longer need the IIFE/global dance.

const NAMESPACE = 'offplan_engine:';
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

const raw = {
  get(key) {
    if (hasLocalStorage) {
      const v = window.localStorage.getItem(ns(key));
      return v === null || v === undefined ? null : v;
    }
    return memStore[key] !== undefined ? memStore[key] : null;
  },
  set(key, value) {
    if (hasLocalStorage) window.localStorage.setItem(ns(key), value);
    else memStore[key] = value;
  },
  remove(key) {
    if (hasLocalStorage) window.localStorage.removeItem(ns(key));
    delete memStore[key];
  },
  list(prefix) {
    const safe = typeof prefix === 'string' ? prefix : '';
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
  },
  clearAll() {
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
  },
};

export const db = {
  async list(prefix) {
    try { return raw.list(prefix); } catch { return []; }
  },
  async get(key) {
    try {
      const v = raw.get(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try { raw.set(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  async delete(key) {
    try { raw.remove(key); return true; } catch { return false; }
  },
  async clearAll() {
    try { raw.clearAll(); return true; } catch { return false; }
  },
  isPersistent() {
    return hasLocalStorage;
  },
};
