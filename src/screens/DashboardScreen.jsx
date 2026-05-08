import { useMemo, useState } from 'react';
import { AlertTriangle, DollarSign, TrendingDown, Zap, Activity, Shield, Target, Users, Droplets, Loader2 } from 'lucide-react';
import { fmtUSD, fmtNum, fmtPct } from '../ui/formatters.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { InputModeBadge, ProvenanceFooter } from '../ui/Provenance.jsx';
import {
  SCENARIO_PRESETS,
  OFFPLAN_MEMBERSHIP_PEPM,
  TPA_PEPM,
  PBM_ADMIN_PEPM,
  FIRSTHEALTH_PEPM,
  MEDWATCH_PEPM,
  ACCIDENT_INDEMNITY_PEPM,
  OFFPLAN_FIXED_OVERHEAD_PEPM,
  DEFAULT_CASH_PRICES,
  DEFAULT_INDEMNITY_BENEFITS,
  DEFAULT_REPRICE_FACTORS,
} from '../constants.js';
import { runCalculation } from '../engine/calculate.js';
import { useLiquidity } from '../hooks/useLiquidity.js';

export function DashboardScreen({ employer, scenario, result, classifiedClaims, onScenarioChange,
                                   inputModeRecord, activePricingVersion, activeRuleVersion,
                                   activeIndemnityVersion, activeBenchmarkVersion }) {
  const lives = Number(employer?.covered_lives) || 1;

  const scenarioComparison = useMemo(() => {
    if (!classifiedClaims.length) return [];
    return Object.entries(SCENARIO_PRESETS).map(([key, preset]) => {
      const r = runCalculation(classifiedClaims, preset, DEFAULT_CASH_PRICES, DEFAULT_INDEMNITY_BENEFITS, DEFAULT_REPRICE_FACTORS);
      const resPEPM = r.aggregates.residual_fund / lives / 12;
      const recPEPM = resPEPM * preset.risk_margin;
      const totalPEPM = OFFPLAN_FIXED_OVERHEAD_PEPM + preset.stop_loss_pepm + recPEPM;
      return {
        key,
        name: preset.name,
        residualPEPM: resPEPM,
        recommendedPEPM: recPEPM,
        stopLossPEPM: preset.stop_loss_pepm,
        totalPEPM,
        annualTotal: totalPEPM * lives * 12,
        residualFund: r.aggregates.residual_fund,
        stopLossShift: r.aggregates.stop_loss_shift,
      };
    });
  }, [classifiedClaims, lives]);

  if (!result) {
    return (
      <EmptyState
        title="No data yet"
        description="Upload claims data or generate a modeled dataset to see the dashboard."
      />
    );
  }

  const a = result.aggregates;
  const residualPEPM = a.residual_fund / lives / 12;
  const recommendedPEPM = residualPEPM * scenario.risk_margin;
  const totalOffPlanPEPM = OFFPLAN_FIXED_OVERHEAD_PEPM + scenario.stop_loss_pepm + recommendedPEPM;
  const totalOffPlanAnnual = totalOffPlanPEPM * lives * 12;
  const rawBaseline = Number(employer?.current_total_healthcare_spend);
  const hasValidBaseline = rawBaseline > 0;
  const savingsBaseline = hasValidBaseline ? rawBaseline : null;
  const annualSavings = hasValidBaseline ? savingsBaseline - totalOffPlanAnnual : null;
  const savingsPct = hasValidBaseline && savingsBaseline > 0 ? annualSavings / savingsBaseline : null;

  // Stochastic liquidity layer (Liquidity Spec v1.2 §3). Two modes:
  //   - timing-resample: resamples the deterministic claims (calibrated to
  //     this employer's actual year). Default.
  //   - tier-generated: generates fresh events from EVENT_TIER_CATALOG
  //     (calibrated to a typical SMB). Drift-pct shows how this employer
  //     compares to the typical-SMB profile.
  // The hook routes to POST /api/liquidity/simulate when VITE_STORAGE_BACKEND=api
  // (5K runs, server-side, Postgres-cached) and falls back to inline
  // computation (1K runs, main thread) on localStorage.
  const [liquidityMode, setLiquidityMode] = useState('timing-resample');
  const { liquidity, loading: liquidityLoading, error: liquidityError, source: liquiditySource } =
    useLiquidity({ employer, scenario, modeledClaims: result?.claims, options: { mode: liquidityMode } });

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Reclassification</h1>
          <p className="text-stone-600 max-w-2xl">
            What used to be claims, repositioned under the OffPlan model.
          </p>
        </div>
        {inputModeRecord && (
          <div className="flex justify-end">
            <InputModeBadge inputModeRecord={inputModeRecord} inline />
          </div>
        )}
      </div>

      <ScenarioToggle scenario={scenario} onScenarioChange={onScenarioChange} />

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm text-amber-900">
        <div className="flex gap-2">
          <AlertTriangle size={16} className="text-amber-700 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Prototype scope: deterministic classification + stochastic MRL with tail overlay.</strong>
            <div className="mt-1 leading-relaxed">
              This build produces the residual fund and the OffPlan stack PEPM (deterministic), plus a Monte Carlo Min Required Liquidity in either timing-resample mode (resamples deterministic claims + Pareto catastrophic tail overlay) or tier-generated mode (events generated fresh from the 11-tier catalog with Poisson/NegBin frequency, run through the full member-aggregating cascade with indemnity offset, aggregate stop-loss corridor, complication recursion, chronic-flag clustering on a pre-sampled chronic member pool, and a monthly-recurrence Specialty Rx regimen on ~3% of members). DPC's clinical effect — monthly-membership absorbing chronic management and PCP catching complication early-warnings — is modeled as a single mitigation factor that shrinks both the per-tier complication probability and the chronic uplift. Stop-loss-eligible (catastrophic) claims spread their cash outflow 1/3 / 1/3 / 1/3 across three months to model adjudication delay + invoice terms; smaller cash-pay claims settle same-month. We take the P95 of max cumulative drawdown across the run set, with bootstrap 95% confidence intervals on every reported percentile. Still deferred per Liquidity Spec v1.2: the bimodal Maternity/NICU (T11) split. The MRL is calibrated to spec-anchored numbers but should still be treated as a directional CFO conversation tool, not as an MGU underwriting submission. The "Risk Margin × Residual" formula in §6.6 of the spec is the deprecated v3.0/v3.1 funding construct retained as an intermediate placeholder.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-medium text-stone-900 mb-1">Baseline Comparison</h3>
            <p className="text-xs text-stone-500 max-w-2xl leading-relaxed">
              Savings are calculated against current total healthcare spend, not claims-only spend.
              Historical claims drive the reclassification model; total spend drives the savings comparison.
            </p>
          </div>
          {employer?.current_funding_model && (
            <div className="text-right text-[11px] text-stone-500">
              <div className="uppercase tracking-wider">Funding Model</div>
              <div className="font-medium text-stone-700 normal-case">
                {employer.plan_type}{employer.baseline_confidence ? ` · ${employer.baseline_confidence} confidence` : ""}
              </div>
            </div>
          )}
        </div>

        <div className="border border-stone-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
                <th className="text-left px-4 py-2.5 font-medium">Metric</th>
                <th className="text-left px-4 py-2.5 font-medium">Purpose</th>
                <th className="text-right px-4 py-2.5 font-medium">Annual</th>
                <th className="text-right px-4 py-2.5 font-medium">PEPM</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-stone-100">
                <td className="px-4 py-3 font-medium text-stone-900">Historical Claims</td>
                <td className="px-4 py-3 text-stone-600">Reclassification modeling</td>
                <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.historical_claims)}</td>
                <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(a.historical_claims / lives / 12, 2)}</td>
              </tr>
              {hasValidBaseline ? (
                <>
                  <tr className="border-b border-stone-100 bg-stone-50/40">
                    <td className="px-4 py-3 font-medium text-stone-900">Current Total Healthcare Spend</td>
                    <td className="px-4 py-3 text-stone-600">Savings comparison baseline</td>
                    <td className="px-4 py-3 text-right font-mono num">{fmtUSD(savingsBaseline)}</td>
                    <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(savingsBaseline / lives / 12, 2)}</td>
                  </tr>
                  <tr className="border-b border-stone-100">
                    <td className="px-4 py-3 font-medium text-stone-900">OffPlan Total Stack</td>
                    <td className="px-4 py-3 text-stone-600">New model</td>
                    <td className="px-4 py-3 text-right font-mono num">{fmtUSD(totalOffPlanAnnual)}</td>
                    <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(totalOffPlanPEPM, 2)}</td>
                  </tr>
                  <tr className="bg-emerald-50/40">
                    <td className="px-4 py-3 font-semibold text-emerald-900">Net Savings</td>
                    <td className="px-4 py-3 text-emerald-800">Total spend minus OffPlan stack</td>
                    <td className={`px-4 py-3 text-right font-mono num font-semibold ${annualSavings >= 0 ? "text-emerald-800" : "text-rose-700"}`}>
                      {fmtUSD(annualSavings)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono num ${annualSavings >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmtPct(savingsPct)}
                    </td>
                  </tr>
                </>
              ) : (
                <tr className="border-b border-stone-100">
                  <td className="px-4 py-3 font-medium text-stone-900">OffPlan Total Stack</td>
                  <td className="px-4 py-3 text-stone-600">New model</td>
                  <td className="px-4 py-3 text-right font-mono num">{fmtUSD(totalOffPlanAnnual)}</td>
                  <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtUSD(totalOffPlanPEPM, 2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!hasValidBaseline && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-900 flex gap-2">
            <AlertTriangle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Current Total Healthcare Spend is required before savings can be calculated.</strong> Historical claims are used only for reclassification modeling and cannot be used as the savings baseline. Add Current Total Healthcare Spend in Setup to enable savings calculations and PDF export.
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
        <h3 className="font-medium text-stone-900 mb-1">Where the historical claims went</h3>
        <p className="text-xs text-stone-500 mb-5">
          Each segment shows what happened to that portion of the original {fmtUSD(a.historical_claims)} in claims.
        </p>
        <FlowChart aggregates={a} historical={a.historical_claims} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard
          icon={DollarSign} accent="stone"
          label="Historical Claims" value={fmtUSD(a.historical_claims)}
          sub={`${fmtNum(classifiedClaims.length)} lines · for modeling`}
        />
        <KPICard
          icon={TrendingDown} accent="emerald"
          label="DPC Eliminated" value={fmtUSD(a.dpc_eliminated)}
          sub={`${fmtPct(a.dpc_eliminated / a.historical_claims)} of historical`}
        />
        <KPICard
          icon={Zap} accent="blue"
          label="Cash-Pay Repricing" value={fmtUSD(a.repriced_savings)}
          sub="Specialty, imaging, procedures"
        />
        <KPICard
          icon={Activity} accent="violet"
          label="ER + Indemnity Offset"
          value={fmtUSD(a.er_reduction_savings + a.indemnity_offset)}
          sub={`Cash benefits: ${fmtUSD(a.indemnity_offset)}`}
        />
        <KPICard
          icon={Shield} accent="rose"
          label="Stop-Loss Shift" value={fmtUSD(a.stop_loss_shift)}
          sub="Above attachment point"
        />
        <KPICard
          icon={Target} accent="amber"
          label="Residual Fund" value={fmtUSD(a.residual_fund)}
          sub={`${fmtUSD(residualPEPM, 2)} PEPM`}
        />
        <KPICard
          icon={DollarSign} accent="stone"
          label="Total OffPlan PEPM"
          value={fmtUSD(totalOffPlanPEPM, 2)}
          sub={`Membership + PBM/Network/UM + Indemnity + TPA + S/L + Claims Fund`}
        />
        <KPICard
          icon={Users} accent="emerald"
          label="Estimated Savings"
          value={hasValidBaseline ? fmtUSD(annualSavings) : "—"}
          sub={hasValidBaseline ? `${fmtPct(savingsPct)} reduction` : "Total Healthcare Spend required"}
        />
      </div>

      <div className="bg-stone-900 text-white rounded-lg p-8 mb-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual Fund · Annual</div>
          <div className="font-display text-5xl mb-1 num">{fmtUSD(a.residual_fund)}</div>
          <div className="text-sm text-stone-300">
            Intermediate output · feeds the stochastic layer
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual PEPM</div>
          <div className="font-display text-5xl mb-1 num">{fmtUSD(residualPEPM, 2)}</div>
          <div className="text-sm text-stone-300">
            Per employee per month · pre-stochastic
          </div>
        </div>
        <div data-testid="mrl-card">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2 flex items-center gap-1.5">
            <span>Min Required Liquidity</span>
            <span className="text-emerald-300 font-normal">· P95 · resample + tail overlay</span>
            {liquiditySource === 'api' && liquidity?.cached && (
              <span className="text-stone-400 font-normal" title="Result served from server cache">· cached</span>
            )}
          </div>
          <div className="font-display text-5xl mb-1 num flex items-center gap-2">
            {liquidityLoading ? (
              <>
                <Loader2 size={24} className="animate-spin text-stone-400" />
                <span className="text-stone-500 text-2xl font-normal">computing…</span>
              </>
            ) : liquidityError ? (
              <span className="text-rose-300 text-2xl">error</span>
            ) : liquidity ? (
              fmtUSD(liquidity.mrl)
            ) : (
              "—"
            )}
          </div>
          <div className="text-sm text-stone-300">
            {liquidityError
              ? `Simulation failed: ${liquidityError.message || liquidityError}`
              : liquidityLoading
              ? `Running ${liquiditySource === 'api' ? '5,000-run server-side' : '1,000-run client-side'} Monte Carlo…`
              : liquidity && liquidity.cer
              ? `${liquidity.cer.toFixed(1)}× capital efficiency vs ELF · ${liquiditySource === 'api' ? 'server-side' : 'client-side'} (${fmtNum(liquidity.meta?.runs || 0)} runs)`
              : "Run a scenario with claims to compute"}
          </div>
        </div>
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 mb-6 text-xs text-stone-600">
        <div className="uppercase tracking-wider text-[10px] text-stone-500 mb-1">Deprecated intermediate placeholder (v3.0/v3.1)</div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span>Residual PEPM × {scenario.risk_margin.toFixed(2)}x risk margin =</span>
          <span className="font-mono num text-stone-800 font-semibold">{fmtUSD(recommendedPEPM, 2)} PEPM</span>
          <span className="text-stone-500">— used for scenario sizing only; not a headline output.</span>
        </div>
      </div>

      {liquidity && (
        <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6" data-testid="liquidity-profile">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Droplets size={16} className="text-blue-600" />
                <h3 className="font-medium text-stone-900">Liquidity Profile</h3>
              </div>
              <p className="text-xs text-stone-500 max-w-2xl leading-relaxed">
                Distribution of max cumulative drawdown across {fmtNum(liquidity.meta.runs)} simulation runs.
                Each run uses uniform monthly placement and a {liquidity.meta.lag_months}-month stop-loss
                reimbursement lag.
                {liquidityMode === 'timing-resample' ? (
                  <> Claims are <strong>resampled from this employer's deterministic year</strong>, then a Pareto tail overlay adds catastrophic events on top. Calibrated to actual claims.</>
                ) : (
                  <> Events are <strong>generated fresh per run</strong> from a typical-SMB tier catalog (Poisson frequency × log-normal/Pareto cost). Drift % below shows how this employer's mix compares to the SMB norm.</>
                )}
                {' '}P95 = MRL.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div data-testid="mode-toggle" className="inline-flex border border-stone-200 rounded overflow-hidden text-[11px]">
                <button
                  data-testid="mode-toggle-resample"
                  onClick={() => setLiquidityMode('timing-resample')}
                  className={`px-2.5 py-1 transition ${liquidityMode === 'timing-resample' ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
                >
                  Resample
                </button>
                <button
                  data-testid="mode-toggle-tier"
                  onClick={() => setLiquidityMode('tier-generated')}
                  className={`px-2.5 py-1 transition border-l border-stone-200 ${liquidityMode === 'tier-generated' ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
                >
                  Tier catalog
                </button>
              </div>
              <div className="text-right text-[11px] text-stone-500">
                <div className="uppercase tracking-wider">Method</div>
                <div className="font-medium text-stone-700 normal-case">{liquidity.meta.method}</div>
              </div>
            </div>
          </div>

          {liquidity.calibration && (
            <div className={`mb-4 rounded border p-3 text-xs leading-relaxed ${liquidity.calibration.out_of_band ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
              <div className="font-medium mb-0.5">
                Calibration drift: {liquidity.calibration.drift_pct == null
                  ? '—'
                  : `${(liquidity.calibration.drift_pct * 100).toFixed(1)}%`}
                {liquidity.calibration.out_of_band && <span> · outside ±{(liquidity.calibration.threshold_pct * 100).toFixed(0)}% threshold</span>}
              </div>
              <div className="opacity-80">
                Simulator's mean residual ({fmtUSD(liquidity.calibration.simulated_mean_residual)}) vs deterministic engine ({fmtUSD(liquidity.calibration.deterministic_residual)}).
                {liquidity.calibration.out_of_band
                  ? ' This employer\'s claim mix differs from the typical-SMB catalog defaults; treat the tier-generated MRL as a sensitivity check rather than a primary number.'
                  : ' Within tolerance; tier-generated and deterministic numbers agree on cost magnitude.'}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {['p50', 'p75', 'p90', 'p95', 'p99'].map((p) => {
              const ci = liquidity.percentiles_ci?.[p];
              return (
                <div key={p} className={`border rounded p-3 ${p === 'p95' ? 'bg-emerald-50 border-emerald-200' : 'border-stone-200'}`}>
                  <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                    {p.toUpperCase()} {p === 'p95' && <span className="text-emerald-700 normal-case">· MRL</span>}
                  </div>
                  <div className="font-mono num text-base text-stone-900">{fmtUSD(liquidity.percentiles[p])}</div>
                  {ci && ci.lo != null && ci.hi != null && (
                    <div className="text-[10px] text-stone-500 mt-0.5 font-mono num">
                      95% CI: {fmtUSD(ci.lo)} – {fmtUSD(ci.hi)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <RatioCard label="Mean Monthly Outflow" value={fmtUSD(liquidity.mean_monthly_outflow)} sub="Across all runs" />
            <RatioCard
              label="Capital Efficiency Ratio"
              value={liquidity.cer ? `${liquidity.cer.toFixed(1)}×` : "—"}
              sub={liquidity.cer ? "ELF / MRL" : "Total spend not set"}
            />
            <RatioCard
              label="Liquidity Reduction"
              value={liquidity.liquidity_reduction_pct != null ? fmtPct(liquidity.liquidity_reduction_pct) : "—"}
              sub="vs level-funded pre-fund"
            />
            <RatioCard
              label="LCR / SCR"
              value={liquidity.lcr && liquidity.scr ? `${liquidity.lcr.toFixed(1)}× / ${liquidity.scr.toFixed(1)}×` : "—"}
              sub="MRL vs mean / P75 outflow"
            />
          </div>

          {liquidity.aggregate_stop_loss?.enabled && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <RatioCard
                label="Aggregate · Trigger Rate"
                value={fmtPct(liquidity.aggregate_stop_loss.trigger_rate, 1)}
                sub={`${fmtNum(liquidity.aggregate_stop_loss.runs_triggering)} of ${fmtNum(liquidity.meta.runs)} runs`}
              />
              <RatioCard
                label="Aggregate · Attachment"
                value={fmtUSD(liquidity.aggregate_stop_loss.attachment_dollars)}
                sub={`${(liquidity.aggregate_stop_loss.attachment_pct * 100).toFixed(0)}% of expected residual`}
              />
              <RatioCard
                label="Aggregate · Mean Recovery"
                value={fmtUSD(liquidity.aggregate_stop_loss.mean_recovery_per_run)}
                sub="Per simulated year"
              />
              <RatioCard
                label="Expected Residual"
                value={fmtUSD(liquidity.aggregate_stop_loss.expected_residual)}
                sub="Underwriting baseline"
              />
            </div>
          )}

          <div className="mt-4 text-[11px] text-stone-500 leading-relaxed border-t border-stone-100 pt-3">
            <strong>Scope note:</strong>{' '}
            {liquidityMode === 'timing-resample' ? (
              <>
                Combines timing variance (resampling deterministic claim months) with a
                Pareto-distributed catastrophic event overlay (λ={liquidity.tail?.lambda_per_member_year ?? '—'} per member-year,
                shape={liquidity.tail?.pareto_shape ?? '—'}, scale={fmtUSD(liquidity.tail?.pareto_scale ?? 0)}).
              </>
            ) : (
              <>
                Generates events fresh per run from {liquidity.meta.catalog_length}-tier catalog (Poisson/NegBin frequency × log-normal/Pareto cost),
                run through the full member-aggregating cascade (indemnity offset → member-aggregate stop-loss split → aggregate corridor).
                Drift_pct vs the deterministic residual reflects event-mix differences from the catalog defaults, not transformation gaps.
              </>
            )}
            {liquidity.payment_schedule?.enabled && (
              <>
                {' '}Stop-loss-eligible claims spread {liquidity.payment_schedule.schedule.map((x, i) => `${(x * 100).toFixed(0)}%`).join(' / ')} across {liquidity.payment_schedule.months} months
                (adjudication delay + invoice terms); smaller claims settle same-month.
              </>
            )}
            {' '}The bimodal Maternity/NICU (T11) split is still deferred
            (see README §11). Use this as a directional CFO conversation anchor, not MGU underwriting input.
            Production replaces this with the full Liquidity Spec v1.2 stochastic layer.
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <h3 className="font-medium text-stone-900">Scenario Comparison</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">Scenario</th>
              <th className="text-right px-5 py-3">Residual Fund</th>
              <th className="text-right px-5 py-3">Stop-Loss Shift</th>
              <th className="text-right px-5 py-3">Residual PEPM</th>
              <th className="text-right px-5 py-3">Total OffPlan PEPM</th>
              <th className="text-right px-5 py-3">Annual Total</th>
            </tr>
          </thead>
          <tbody>
            {scenarioComparison.map((s) => (
              <tr key={s.key} className={`border-b border-stone-100 ${s.name === scenario.name ? "bg-stone-50" : ""}`}>
                <td className="px-5 py-3">
                  <div className="font-medium">{s.name}</div>
                  {s.name === scenario.name && (
                    <div className="text-xs text-emerald-700">Active</div>
                  )}
                </td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.residualFund)}</td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.stopLossShift)}</td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.residualPEPM, 2)}</td>
                <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.totalPEPM, 2)}</td>
                <td className="px-5 py-3 text-right font-mono num font-medium">{fmtUSD(s.annualTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5 mt-6">
        <ProvenanceFooter
          inputModeRecord={inputModeRecord}
          pricingVersion={activePricingVersion}
          ruleVersion={activeRuleVersion}
          indemnityVersion={activeIndemnityVersion}
          benchmarkVersion={activeBenchmarkVersion}
          scenario={scenario}
          claims={classifiedClaims}
        />
      </div>
    </div>
  );
}

function ScenarioToggle({ scenario, onScenarioChange }) {
  const activeKey = Object.entries(SCENARIO_PRESETS).find(([, p]) => p.name === scenario.name)?.[0];
  const activeDescription = SCENARIO_PRESETS[activeKey]?.description;
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold">Featured Scenario</span>
          <div className="flex border border-stone-200 rounded overflow-hidden">
            {Object.entries(SCENARIO_PRESETS).map(([key, p], i, arr) => (
              <button
                key={key}
                onClick={() => onScenarioChange({ ...p })}
                className={`px-4 h-9 text-sm font-medium transition ${
                  i < arr.length - 1 ? "border-r border-stone-200" : ""
                } ${
                  scenario.name === p.name
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        {activeDescription && (
          <div className="text-xs text-stone-500 italic max-w-md text-right">
            {activeDescription}
          </div>
        )}
      </div>
    </div>
  );
}

function RatioCard({ label, value, sub }) {
  return (
    <div className="border border-stone-200 rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">{label}</div>
      <div className="font-mono num text-base text-stone-900 mb-0.5">{value}</div>
      <div className="text-[10px] text-stone-500">{sub}</div>
    </div>
  );
}

function KPICard({ icon: Icon, accent, label, value, sub }) {
  const accents = {
    stone:   "text-stone-700 bg-stone-100",
    emerald: "text-emerald-700 bg-emerald-100",
    blue:    "text-blue-700 bg-blue-100",
    violet:  "text-violet-700 bg-violet-100",
    amber:   "text-amber-700 bg-amber-100",
    rose:    "text-rose-700 bg-rose-100",
  };
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded grid place-items-center ${accents[accent]}`}>
          <Icon size={12} />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      </div>
      <div className="font-mono num text-2xl text-stone-900 mb-1">{value}</div>
      <div className="text-xs text-stone-500">{sub}</div>
    </div>
  );
}

function FlowChart({ aggregates: a, historical }) {
  const segments = [
    { label: "DPC Eliminated",    value: a.dpc_eliminated,        color: "bg-emerald-500", text: "text-emerald-900" },
    { label: "Repriced Savings",  value: a.repriced_savings,      color: "bg-blue-500",    text: "text-blue-900" },
    { label: "ER Reduction",      value: a.er_reduction_savings,  color: "bg-violet-400",  text: "text-violet-900" },
    { label: "Indemnity Offset",  value: a.indemnity_offset,      color: "bg-violet-600",  text: "text-violet-900" },
    { label: "Stop-Loss Shift",   value: a.stop_loss_shift,       color: "bg-rose-500",    text: "text-rose-900" },
    { label: "Residual Fund",     value: a.residual_fund,         color: "bg-amber-500",   text: "text-amber-900" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      <div className="h-12 rounded overflow-hidden flex border border-stone-200">
        {segments.map((s) => {
          const pct = (s.value / historical) * 100;
          return (
            <div
              key={s.label}
              className={`${s.color} relative group`}
              style={{ width: `${pct}%`, minWidth: pct > 0.5 ? "auto" : "0" }}
            >
              {pct > 8 && (
                <div className="absolute inset-0 px-2 flex items-center text-xs text-white font-medium truncate">
                  {fmtPct(s.value / historical, 0)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-4">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-sm ${s.color}`} />
            <div className="text-xs">
              <span className="text-stone-700">{s.label}: </span>
              <span className="font-mono num text-stone-900">{fmtUSD(s.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
