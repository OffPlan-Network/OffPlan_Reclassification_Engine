// Tiny local HTTP server that mounts the /api/storage/* Vercel Function
// files and serves them on http://localhost:<PORT>. Used for two things:
//
//   1. Running scripts/api-test.mjs end-to-end without needing `vercel dev`
//      (which requires interactive `vercel login` + `vercel link` first).
//   2. As an escape hatch for local UI development if `vercel dev` is
//      unavailable — pair it with `npm run dev` (Vite) and a Vite proxy
//      that forwards /api/* to this port.
//
// The shim adapts Node's req/res to the shape Vercel Functions expect:
// req.query parsed from the URL, req.body parsed from JSON, res.status()
// and res.setHeader()/res.json() helpers wired up.

import http from 'node:http';
import { URL } from 'node:url';

import storageIndexHandler from '../api/storage/index.js';
import storageKeyHandler from '../api/storage/[key].js';
import liquiditySimulateHandler from '../api/liquidity/simulate.js';

const PORT = Number(process.env.API_PORT) || 4000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(undefined);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', reject);
  });
}

function decorateRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function route(pathname) {
  // Match /api/storage and /api/storage/<key>. Keys may contain colons,
  // so we stop at the first / past /api/storage/ for nested segments.
  if (pathname === '/api/storage' || pathname === '/api/storage/') {
    return { handler: storageIndexHandler, params: {} };
  }
  if (pathname.startsWith('/api/storage/')) {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    return { handler: storageKeyHandler, params: { key } };
  }
  if (pathname === '/api/liquidity/simulate') {
    return { handler: liquiditySimulateHandler, params: {} };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  decorateRes(res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const matched = route(url.pathname);
    if (!matched) {
      return res.status(404).json({ error: 'Not Found' });
    }
    const query = Object.fromEntries(url.searchParams.entries());
    req.query = { ...query, ...matched.params };
    req.body = await readJsonBody(req);
    await matched.handler(req, res);
  } catch (err) {
    console.error('[api-server] handler exploded', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`[api-server] listening on http://localhost:${PORT}`);
});

// Allow `node --env-file=.env.local scripts/api-server.mjs` to be killed by Ctrl-C
// or by the parent test script via SIGTERM/SIGINT.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[api-server] received ${sig}, shutting down`);
    server.close(() => process.exit(0));
  });
}
