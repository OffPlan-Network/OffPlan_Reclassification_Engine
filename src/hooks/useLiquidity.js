import { useEffect, useRef, useState } from 'react';
import { simulateLiquidity } from '../engine/stochastic.js';

const STORAGE_BACKEND = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STORAGE_BACKEND) || 'localStorage';

// Cheap stable hash of the inputs that affect the simulation outcome.
// Used to detect when we need to re-fetch / re-compute.
function fingerprint(employer, scenario, claims, mode) {
  const empSig = `${employer?.id}|${employer?.covered_lives}|${employer?.current_total_healthcare_spend}|${employer?.chronic_prevalence ?? 'def'}`;
  const scnSig = JSON.stringify(scenario || {});
  let total = 0;
  for (const c of claims || []) total += Number(c?.allowed_amount) || 0;
  const claimsSig = `${(claims || []).length}:${Math.round(total)}`;
  return `${empSig}::${scnSig}::${claimsSig}::${mode || 'default'}`;
}

/**
 * Returns the latest LiquidityResult for the given (employer, scenario,
 * claims) tuple. Behaviour depends on VITE_STORAGE_BACKEND:
 *
 *   - "api": POSTs to /api/liquidity/simulate. Result is cached server-side
 *     (Postgres) keyed by scenario + claims hash. Default 5,000 runs.
 *
 *   - "localStorage" (or anything else): runs simulateLiquidity inline on
 *     the main thread. Default 1,000 runs.
 *
 * The hook returns { liquidity, loading, error, source }. `source` is
 * "api" | "local" | "idle" so the UI can disclose where the number came
 * from. The hook re-fetches automatically when fingerprint() changes.
 */
export function useLiquidity({ employer, scenario, modeledClaims, options = {} }) {
  const [state, setState] = useState({ liquidity: null, loading: false, error: null, source: 'idle' });
  // Track the in-flight request so we can ignore stale responses.
  const inFlightFp = useRef(null);
  const mode = options.mode || 'timing-resample';

  useEffect(() => {
    if (!employer?.id || !scenario || !modeledClaims?.length) {
      setState({ liquidity: null, loading: false, error: null, source: 'idle' });
      return;
    }

    const fp = fingerprint(employer, scenario, modeledClaims, mode);
    inFlightFp.current = fp;

    if (STORAGE_BACKEND !== 'api') {
      // Local path: synchronous compute on the main thread.
      try {
        const liq = simulateLiquidity({
          employer,
          scenario,
          modeledClaims,
          options: { runs: options.runs || 1000, mode },
        });
        if (inFlightFp.current === fp) {
          setState({ liquidity: liq, loading: false, error: null, source: 'local' });
        }
      } catch (err) {
        if (inFlightFp.current === fp) {
          setState({ liquidity: null, loading: false, error: err, source: 'local' });
        }
      }
      return;
    }

    // API path. Show loading and dispatch.
    setState((s) => ({ ...s, loading: true, error: null, source: 'api' }));

    let cancelled = false;
    fetch('/api/liquidity/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employerId: employer.id,
        scenario,
        runs: options.runs || 5000,
        options: { mode },
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((liq) => {
        if (cancelled || inFlightFp.current !== fp) return;
        setState({ liquidity: liq, loading: false, error: null, source: 'api' });
      })
      .catch((err) => {
        if (cancelled || inFlightFp.current !== fp) return;
        setState({ liquidity: null, loading: false, error: err, source: 'api' });
      });

    return () => { cancelled = true; };
  }, [employer?.id, employer?.covered_lives, employer?.current_total_healthcare_spend, employer?.chronic_prevalence, scenario, modeledClaims, options.runs, mode]);

  return state;
}
