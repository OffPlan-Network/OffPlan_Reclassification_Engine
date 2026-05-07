// POST /api/liquidity/simulate
//
// Body: { employerId: string, scenario: object, runs?: number, force?: boolean, options?: object }
//
// Behaviour:
//   1. Read the classified claims for `employerId` from app_data.
//   2. Re-run the deterministic cascade (so we have residual_amount /
//      stop_loss_amount stamped per-claim).
//   3. Run simulateLiquidity at the requested run count (default 5000).
//   4. Cache the result in app_data under
//      `liquidity_cache:<employerId>:<scenarioHash>:<claimsSig>:<runs>`.
//      Subsequent calls with the same inputs return the cached result.
//   5. Return the LiquidityResult plus a `cached: bool` flag.
//
// The cache key includes a fingerprint of the claims (length + summed allowed
// amount) so that re-ingesting claims for the same employer invalidates
// stale results without us needing a separate invalidation pass.

import {
  StorageError,
  getOne,
  setOne,
  parseBody,
} from '../_lib/storage-handler.js';
import { runCalculation } from '../../src/engine/calculate.js';
import { simulateLiquidity } from '../../src/engine/stochastic.js';
import {
  DEFAULT_CASH_PRICES,
  DEFAULT_INDEMNITY_BENEFITS,
  DEFAULT_REPRICE_FACTORS,
} from '../../src/constants.js';

const DEFAULT_RUNS = 5000;
const CACHE_VERSION = 'v1';   // bump when sim semantics change to invalidate caches

// FNV-1a string hash. Same shape as the engine's internal seed hash but
// emits a hex digest suitable for cache keys.
function hashString(parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'string' ? p : JSON.stringify(p ?? null);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function claimsSignature(claims) {
  // Cheap fingerprint — length + total allowed (rounded). Sensitive enough
  // to invalidate when claims change, fast enough to compute on every call.
  let total = 0;
  for (const c of claims || []) total += Number(c.allowed_amount) || 0;
  return `${(claims || []).length}:${Math.round(total)}`;
}

function cacheKey(employerId, scenario, claimsSig, runs) {
  const scenarioHash = hashString([
    scenario?.name,
    scenario?.dpc_elimination_pct,
    scenario?.urgent_care_reduction_pct,
    scenario?.er_reduction_pct,
    scenario?.cashpay_discount_factor,
    scenario?.indemnity_enabled,
    scenario?.attachment_point,
    scenario?.stop_loss_pepm,
    scenario?.risk_margin,
  ]);
  return `liquidity_cache:${CACHE_VERSION}:${employerId}:${scenarioHash}:${hashString([claimsSig])}:${runs}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const body = parseBody(req);
    const { employerId, scenario, options } = body;
    const force = body.force === true;
    const runs = Math.max(100, Math.min(20000, Number(body.runs) || DEFAULT_RUNS));

    if (!employerId || typeof employerId !== 'string') {
      throw new StorageError(400, 'employerId is required');
    }
    if (!scenario || typeof scenario !== 'object') {
      throw new StorageError(400, 'scenario is required');
    }

    // 1. Pull classified claims from app_data.
    const claims = await getOne(`claims:${employerId}`);
    if (!Array.isArray(claims) || claims.length === 0) {
      throw new StorageError(404, `no claims found for employer ${employerId}`);
    }

    // 2. Cache lookup.
    const sig = claimsSignature(claims);
    const key = cacheKey(employerId, scenario, sig, runs);
    if (!force) {
      const hit = await getOne(key);
      if (hit && hit.result) {
        return res.status(200).json({ ...hit.result, cached: true, cache_key: key });
      }
    }

    // 3. Re-run the deterministic cascade. We pull the employer profile so
    // simulateLiquidity has covered_lives + current_total_healthcare_spend.
    const employer = (await getOne(`employer:${employerId}`)) || {};

    const t0 = Date.now();
    const calc = runCalculation(
      claims,
      scenario,
      DEFAULT_CASH_PRICES,
      DEFAULT_INDEMNITY_BENEFITS,
      DEFAULT_REPRICE_FACTORS,
    );
    const tCalc = Date.now() - t0;

    const t1 = Date.now();
    const liq = simulateLiquidity({
      employer,
      scenario,
      modeledClaims: calc.claims,
      options: { runs, ...(options || {}) },
    });
    const tSim = Date.now() - t1;

    // 4. Persist to cache. Best-effort — if the write fails we still return
    // the freshly-computed result.
    const result = {
      ...liq,
      timings_ms: { cascade: tCalc, simulation: tSim },
    };
    try {
      await setOne(key, { result, computed_at: new Date().toISOString(), runs, sig });
    } catch (writeErr) {
      console.warn('[liquidity/simulate] cache write failed', writeErr);
    }

    return res.status(200).json({ ...result, cached: false, cache_key: key });
  } catch (err) {
    if (err instanceof StorageError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[/api/liquidity/simulate] unexpected error', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
