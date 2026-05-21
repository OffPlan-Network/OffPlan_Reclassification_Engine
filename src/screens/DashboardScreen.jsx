import { useMemo, useState } from 'react';
import { AlertTriangle, DollarSign, TrendingDown, Zap, Activity, Shield, Target, Users, Droplets, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { fmtUSD, fmtNum, fmtPct } from '../ui/formatters.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { InputModeBadge, ProvenanceFooter } from '../ui/Provenance.jsx';
import {
  SCENARIO_PRESETS,
  OFFPLAN_MEMBERSHIP_PEPM,
  TPA_PEPM,
  PBM_ADMIN_PEPM,
  NETWORK_ACCESS_PEPM,
  UM_CM_PEPM,
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
    const presetRows = Object.entries(SCENARIO_PRESETS).map(([key, preset]) => {
      const r = runCalculation(classifiedClaims, preset, DEFAULT_CASH_PRICES, DEFAULT_INDEMNITY_BENEFITS, DEFAULT_REPRICE_FACTORS);
      const resPEPM = r.aggregates.residual_fund / lives / 12;
      const recPEPM = resPEPM * preset.risk_margin;
      const totalPEPM = OFFPLAN_FIXED_OVERHEAD_PEPM + preset.stop_loss_pepm + recPEPM;
      return {
        key,
        name: preset.name,
        isCustom: false,
        residualPEPM: resPEPM,
        recommendedPEPM: recPEPM,
        stopLossPEPM: preset.stop_loss_pepm,
        totalPEPM,
        annualTotal: totalPEPM * lives * 12,
        residualFund: r.aggregates.residual_fund,
        stopLossShift: r.aggregates.stop_loss_shift,
      };
    });

    // Detect whether the active scenario is a customized variant — i.e.
    // doesn't match any preset exactly across the knobs that actually
    // affect the cascade. If customized, add it as a 4th column so the
    // user can see their custom scenario alongside the three presets.
    const knobsToCompare = [
      'dpc_elimination_pct', 'urgent_care_reduction_pct', 'er_reduction_pct',
      'cashpay_discount_factor', 'attachment_point', 'stop_loss_pepm',
      'risk_margin', 'indemnity_enabled', 'aggregate_stop_loss_enabled',
      'aggregate_attachment_pct', 'dpc_clinical_mitigation_pct',
    ];
    const matchesPreset = Object.values(SCENARIO_PRESETS).some((preset) =>
      knobsToCompare.every((k) => {
        const a = scenario?.[k], b = preset?.[k];
        if (typeof a === 'number' || typeof b === 'number') return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-6;
        return a === b;
      })
    );
    if (!matchesPreset) {
      const r = runCalculation(classifiedClaims, scenario, DEFAULT_CASH_PRICES, DEFAULT_INDEMNITY_BENEFITS, DEFAULT_REPRICE_FACTORS);
      const resPEPM = r.aggregates.residual_fund / lives / 12;
      const recPEPM = resPEPM * (Number(scenario.risk_margin) || 1);
      const totalPEPM = OFFPLAN_FIXED_OVERHEAD_PEPM + (Number(scenario.stop_loss_pepm) || 0) + recPEPM;
      presetRows.push({
        key: 'custom',
        name: `${scenario.name} (custom)`,
        isCustom: true,
        residualPEPM: resPEPM,
        recommendedPEPM: recPEPM,
        stopLossPEPM: Number(scenario.stop_loss_pepm) || 0,
        totalPEPM,
        annualTotal: totalPEPM * lives * 12,
        residualFund: r.aggregates.residual_fund,
        stopLossShift: r.aggregates.stop_loss_shift,
      });
    }
    return presetRows;
  }, [classifiedClaims, lives, scenario]);

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
  const [scopeExpanded, setScopeExpanded] = useState(false);
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

      <div className="bg-amber-50 border border-amber-200 rounded-lg mb-4 text-sm text-amber-900">
        <button
          onClick={() => setScopeExpanded((s) => !s)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-amber-100/40 transition rounded-lg"
        >
          <AlertTriangle size={16} className="text-amber-700 flex-shrink-0" />
          <strong className="flex-1">
            Prototype scope: deterministic classification + stochastic MRL with full Liquidity Spec v1.2 §4 layer.
          </strong>
          <span className="text-xs text-amber-700 normal-case font-normal">
            {scopeExpanded ? "Hide details" : "Show details"}
          </span>
          {scopeExpanded ? <ChevronDown size={14} className="text-amber-700" /> : <ChevronRight size={14} className="text-amber-700" />}
        </button>
        {scopeExpanded && (
          <div className="px-4 pb-4 pt-1 leading-relaxed border-t border-amber-200/60 ml-6">
            This build produces the residual fund and the OffPlan stack PEPM (deterministic), plus a Monte Carlo Min Required Liquidity in either timing-resample mode (resamples deterministic claims + Pareto catastrophic tail overlay) or tier-generated mode (events generated fresh from the 12-tier catalog with Poisson/NegBin frequency, run through the full member-aggregating cascade with indemnity offset, aggregate stop-loss corridor, complication recursion, chronic-flag clustering on a pre-sampled chronic member pool, monthly-recurrence Specialty Rx regimen on ~3% of members, and a bimodal Maternity split that prices routine deliveries via cash-pay repricing while NICU complications flow through stop-loss). DPC's clinical effect — monthly-membership absorbing chronic management and PCP catching complication early-warnings — is modeled as a single mitigation factor that shrinks both the per-tier complication probability and the chronic uplift. Stop-loss-eligible (catastrophic) claims spread their cash outflow 1/3 / 1/3 / 1/3 across three months to model adjudication delay + invoice terms; smaller cash-pay claims settle same-month. We take the P95 of max cumulative drawdown across the run set, with bootstrap 95% confidence intervals on every reported percentile. Every Liquidity Spec v1.2 §4 stochastic-layer item is now implemented. The MRL is calibrated to spec-anchored numbers but should still be treated as a directional CFO conversation tool, not as an MGU underwriting submission. The "Risk Margin × Residual" formula in §6.6 of the spec is the deprecated v3.0/v3.1 funding construct retained as an intermediate placeholder.
          </div>
        )}
      </div>

      <SpendComparison
        employer={employer}
        scenario={scenario}
        lives={lives}
        hasValidBaseline={hasValidBaseline}
        savingsBaseline={savingsBaseline}
        historicalClaims={a.historical_claims}
        totalOffPlanAnnual={totalOffPlanAnnual}
        totalOffPlanPEPM={totalOffPlanPEPM}
        recommendedPEPM={recommendedPEPM}
      />


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
          tooltip={`Σ allowed_amount over ${fmtNum(classifiedClaims.length)} non-excluded claim lines. The modeling input — what the claims file actually paid out under the OLD model. Not the savings comparison baseline (use Current Total Healthcare Spend for that).`}
        />
        <KPICard
          icon={TrendingDown} accent="emerald"
          label="DPC Eliminated" value={fmtUSD(a.dpc_eliminated)}
          sub={`${fmtPct(a.dpc_eliminated / a.historical_claims)} of historical`}
          tooltip={`${fmtPct(scenario.dpc_elimination_pct)} of Bucket A (Primary Care, Lab, prevention) absorbed by DPC monthly membership. These dollars disappear under OffPlan — DPC absorbs the visit cost.`}
        />
        <KPICard
          icon={Zap} accent="blue"
          label="Cash-Pay Repricing" value={fmtUSD(a.repriced_savings)}
          sub="Specialty, imaging, procedures"
          tooltip={`Bucket B compression via cash-pay network. Default: ${fmtPct(1 - scenario.cashpay_discount_factor)} reduction on specialty consults, imaging, ASC procedures, and routine maternity (T11). The network charges transparent contracted rates instead of insurance-billed pricing.`}
        />
        <KPICard
          icon={Activity} accent="violet"
          label="ER + Indemnity Offset"
          value={fmtUSD(a.er_reduction_savings + a.indemnity_offset)}
          sub={`Cash benefits: ${fmtUSD(a.indemnity_offset)}`}
          tooltip={`ER reduction (${fmtUSD(a.er_reduction_savings)}): ${fmtPct(scenario.er_reduction_pct)} of Bucket C ER spend intercepted by DPC + telehealth + urgent care. Indemnity offset (${fmtUSD(a.indemnity_offset)}): per-event cash benefits applied to ER, hospital admit, hospital day, outpatient surgery, imaging events.`}
        />
        <KPICard
          icon={Shield} accent="rose"
          label="Stop-Loss Shift" value={fmtUSD(a.stop_loss_shift)}
          sub="Above attachment point"
          tooltip={`Catastrophic dollars above the $${fmtNum(scenario.attachment_point)} member-aggregate attachment, shifted to the specific stop-loss carrier. Aggregated per member first (the spec-mandatory step) — splitting per claim would understate the catastrophic shift.`}
        />
        <KPICard
          icon={Target} accent="amber"
          label="Residual Fund" value={fmtUSD(a.residual_fund)}
          sub={`${fmtUSD(residualPEPM, 2)} PEPM`}
          tooltip={`Whatever's left on each claim after DPC, repricing, ER reduction, indemnity, and stop-loss have been applied. The dollars the employer actually has to fund out of pocket annually under OffPlan. Per-employee monthly: ${fmtUSD(residualPEPM, 2)}.`}
        />
        <KPICard
          icon={DollarSign} accent="stone"
          label="Total OffPlan PEPM"
          value={fmtUSD(totalOffPlanPEPM, 2)}
          sub={`Membership + PBM/Network/UM + Indemnity + TPA + S/L + Claims Fund`}
          tooltip={`$${OFFPLAN_FIXED_OVERHEAD_PEPM.toFixed(2)} fixed overhead (membership $${OFFPLAN_MEMBERSHIP_PEPM} + TPA $${TPA_PEPM} + PBM $${PBM_ADMIN_PEPM} + Network $${NETWORK_ACCESS_PEPM} + UM/CM $${UM_CM_PEPM} + Accident/Indemnity $${ACCIDENT_INDEMNITY_PEPM}) + $${scenario.stop_loss_pepm} stop-loss + $${recommendedPEPM.toFixed(2)} residual claims-fund placeholder (residual PEPM × ${scenario.risk_margin}× risk margin, deprecated v3.0/v3.1 — replaced by stochastic MRL in production).`}
        />
        <KPICard
          icon={Users} accent="emerald"
          label="Estimated Savings"
          value={hasValidBaseline ? fmtUSD(annualSavings) : "—"}
          sub={hasValidBaseline ? `${fmtPct(savingsPct)} reduction` : "Total Healthcare Spend required"}
          tooltip={hasValidBaseline ? `Current Total Healthcare Spend ($${fmtNum(savingsBaseline)}) − OffPlan Total Annual ($${fmtNum(totalOffPlanAnnual)}). Compares against the all-in current cost (premium for fully insured, total plan cost for self-funded), NOT historical claims spend. Historical claims drive the modeling; total spend drives the savings comparison.` : `Set Current Total Healthcare Spend in Setup to enable savings calculation. The savings baseline must include premium / TPA / network / stop-loss / admin (not just claims) to be a defensible comparison.`}
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
            {' '}Every Liquidity Spec v1.2 §4 item is now implemented (see README §11).
            Use this as a directional CFO conversation anchor, not MGU underwriting input.
            Production replaces the auto-estimated chronic prevalence with employer-supplied HCC data or full ICD-10 ingestion.
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
          <h3 className="font-medium text-stone-900">Scenario Comparison</h3>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
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
            {scenarioComparison.map((s) => {
              const isActive = s.isCustom || s.name === scenario.name;
              const rowClass = s.isCustom
                ? "border-b border-emerald-100 bg-emerald-50/40"
                : isActive
                  ? "border-b border-stone-100 bg-stone-50"
                  : "border-b border-stone-100";
              return (
                <tr key={s.key} className={rowClass}>
                  <td className="px-5 py-3">
                    <div className="font-medium flex items-center gap-2">
                      {s.name}
                      {s.isCustom && (
                        <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">Custom</span>
                      )}
                    </div>
                    {isActive && !s.isCustom && (
                      <div className="text-xs text-emerald-700">Active</div>
                    )}
                    {s.isCustom && (
                      <div className="text-xs text-emerald-700">Active · differs from presets</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.residualFund)}</td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.stopLossShift)}</td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.residualPEPM, 2)}</td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtUSD(s.totalPEPM, 2)}</td>
                  <td className="px-5 py-3 text-right font-mono num font-medium">{fmtUSD(s.annualTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
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

// Funding-model-aware copy. Two display modes:
//   - "bundled": FI and LF — single historical line representing the actual
//     monthly check (Carrier Premium / Level-Funded Contribution). The
//     synthetic claims-vs-load split is offered as an expandable disclosure
//     for context, NOT as a separate row, because it doesn't match cash flow.
//   - "itemized": SF (and Unsure as default) — historical splits into Claims
//     + Premiums & Admin because these are genuinely separate checks to
//     different vendors.
const FUNDING_DISPLAY = {
  fully_insured: {
    mode: 'bundled',
    bundledLabel: 'Carrier Premium',
    bundledDetail: 'Single annual premium paid to the carrier. The carrier internally allocates this across claims, admin, UM/CM, stop-loss reinsurance, and margin — but the employer writes one check.',
    note: 'Fully insured plans bundle everything into premium. Component-level Δ is meaningful only on the OffPlan side; the headline savings number is the Total row delta.',
    insideTitle: 'What is inside that premium?',
  },
  level_funded: {
    mode: 'bundled',
    bundledLabel: 'Level-Funded Contribution',
    bundledDetail: 'Single monthly level-funded contribution. Bundles expected claims fund + stop-loss + TPA/admin + carrier margin. Surplus refund (if any) on under-run claims is not modeled in this comparison.',
    note: 'Level-funded plans look like a single check to the employer each month even though the carrier internally allocates claims fund vs stop-loss vs admin. Component-level Δ is meaningful only on the OffPlan side.',
    insideTitle: 'What is inside that contribution?',
  },
  self_funded: {
    mode: 'itemized',
    histClaimsDetail: 'Pass-through claims paid directly by the self-funded plan (via the TPA).',
    histLoadDetail: 'Stop-loss premium + TPA + network access + PBM admin + broker fees. Separate vendors, separate checks.',
    note: 'Self-funded employers genuinely pay claims and overhead as separate line items — the historical decomposition mirrors actual cash flow.',
  },
  unsure: {
    mode: 'itemized',
    histClaimsDetail: 'Historical 12-month claims spend used for reclassification modeling.',
    histLoadDetail: 'Non-claims portion of current total healthcare spend — treated as bundled insurer / TPA overhead.',
    note: 'Funding model not specified — defaulting to itemized historical display. Set the funding model in Setup for a more accurate cash-flow comparison.',
  },
};

function SpendComparison({ employer, scenario, lives, hasValidBaseline, savingsBaseline, historicalClaims, totalOffPlanAnnual, totalOffPlanPEPM, recommendedPEPM }) {
  const fundingModel = employer?.current_funding_model || 'unsure';
  const display = FUNDING_DISPLAY[fundingModel] || FUNDING_DISPLAY.unsure;
  const [showInside, setShowInside] = useState(false);

  // Synthetic decomposition — meaningful as context for bundled-premium
  // funding models, used directly as row values for itemized funding models.
  const histClaims = Math.max(0, Number(historicalClaims) || 0);
  const histLoad = hasValidBaseline ? Math.max(0, savingsBaseline - histClaims) : 0;

  // OffPlan decomposition into 3 buckets — same for all funding models.
  //   1. Claims = residual fund (deprecated v3.0/v3.1 placeholder for the
  //      claims pass-through; production replaces with stochastic MRL).
  //   2. DPC / Membership = OFFPLAN_MEMBERSHIP_PEPM × lives × 12.
  //   3. Premiums & Admin = stop-loss + accident/indemnity + TPA + PBM +
  //      Network + UM/CM, annualized.
  const offplanClaimsAnnual = recommendedPEPM * lives * 12;
  const offplanDpcAnnual = OFFPLAN_MEMBERSHIP_PEPM * lives * 12;
  const offplanPremiumsPEPM =
    scenario.stop_loss_pepm + ACCIDENT_INDEMNITY_PEPM +
    TPA_PEPM + PBM_ADMIN_PEPM + NETWORK_ACCESS_PEPM + UM_CM_PEPM;
  const offplanPremiumsAnnual = offplanPremiumsPEPM * lives * 12;
  const offplanDetail = {
    claims: `Residual fund (variable) — residual PEPM × ${scenario.risk_margin.toFixed(2)}× risk margin. Deprecated v3.0/v3.1 placeholder; production replaces with stochastic MRL.`,
    dpc: `OffPlan membership at $${OFFPLAN_MEMBERSHIP_PEPM}/PEPM. Absorbs primary care, prevention, basic labs.`,
    premiums: `Stop-loss $${scenario.stop_loss_pepm} + Accident/Indemnity $${ACCIDENT_INDEMNITY_PEPM} + TPA $${TPA_PEPM} + PBM $${PBM_ADMIN_PEPM} + Network $${NETWORK_ACCESS_PEPM} + UM/CM $${UM_CM_PEPM} = $${offplanPremiumsPEPM.toFixed(2)} PEPM.`,
  };

  // Build rows. Bundled funding models get one historical-only row plus
  // three OffPlan-only rows. Itemized funding models get three matched
  // historical+OffPlan rows.
  const rows = display.mode === 'bundled'
    ? [
        {
          key: 'bundled',
          label: display.bundledLabel,
          hist: savingsBaseline,
          offplan: null,
          histDetail: display.bundledDetail,
          offplanDetail: 'Replaced by the three OffPlan line items below.',
        },
        { key: 'claims',   label: 'Claims',           hist: null, offplan: offplanClaimsAnnual,   histDetail: 'Bundled in the line above.', offplanDetail: offplanDetail.claims },
        { key: 'dpc',      label: 'DPC / Membership', hist: null, offplan: offplanDpcAnnual,      histDetail: 'No equivalent — DPC is the OffPlan-specific layer.', offplanDetail: offplanDetail.dpc },
        { key: 'premiums', label: 'Premiums & Admin', hist: null, offplan: offplanPremiumsAnnual, histDetail: 'Bundled in the line above.', offplanDetail: offplanDetail.premiums },
      ]
    : [
        { key: 'claims',   label: 'Claims',           hist: histClaims, offplan: offplanClaimsAnnual,   histDetail: display.histClaimsDetail, offplanDetail: offplanDetail.claims },
        { key: 'dpc',      label: 'DPC / Membership', hist: null,        offplan: offplanDpcAnnual,      histDetail: 'No equivalent — DPC is the OffPlan-specific layer.', offplanDetail: offplanDetail.dpc },
        { key: 'premiums', label: 'Premiums & Admin', hist: histLoad,    offplan: offplanPremiumsAnnual, histDetail: display.histLoadDetail, offplanDetail: offplanDetail.premiums },
      ];

  const totalDelta = hasValidBaseline ? totalOffPlanAnnual - savingsBaseline : null;
  const savingsPct = hasValidBaseline && savingsBaseline > 0 ? (savingsBaseline - totalOffPlanAnnual) / savingsBaseline : null;

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
      {/* Header: title + funding model badge */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h3 className="font-medium text-stone-900 mb-1">Spend Comparison &amp; Composition</h3>
          <p className="text-xs text-stone-500 max-w-2xl leading-relaxed">
            {hasValidBaseline
              ? (display.mode === 'bundled'
                  ? `Historical side shows the actual cash outflow — one bundled payment to the carrier. OffPlan side splits into the three real line items (claims fund, DPC membership, premiums & admin) since those are separate monthly payments to separate vendors.`
                  : `Side-by-side decomposition of cash outflows. Self-funded employers pay claims and overhead as genuinely separate line items.`)
              : `Add Current Total Healthcare Spend in Setup to see side-by-side savings. The OffPlan stack composition is shown below regardless.`}
          </p>
        </div>
        {employer?.plan_type && (
          <div className="text-right text-[11px] text-stone-500">
            <div className="uppercase tracking-wider">Funding Model</div>
            <div className="font-medium text-stone-700 normal-case">
              {employer.plan_type}{employer.baseline_confidence ? ` · ${employer.baseline_confidence} confidence` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Modeling-input memo: Historical Claims is informational, not in savings calc */}
      <div className="bg-stone-50 border border-stone-200 rounded px-3 py-2 mb-4 flex items-center gap-3 flex-wrap text-xs">
        <span className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold whitespace-nowrap">Modeling input</span>
        <span className="text-stone-700 whitespace-nowrap">Historical Claims (12 mo):</span>
        <span className="font-mono num text-stone-900 font-semibold">{fmtUSD(histClaims)}</span>
        <span className="text-stone-500 font-mono num">· {fmtUSD(histClaims / lives / 12, 2)} PEPM</span>
        <span className="text-stone-500 italic">— used for reclassification only, not the savings calc</span>
      </div>

      {/* Main comparison table */}
      <div className="border border-stone-200 rounded overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
              <th className="text-left px-4 py-2.5 font-medium">Component</th>
              <th className="text-right px-4 py-2.5 font-medium">Historical</th>
              <th className="text-right px-4 py-2.5 font-medium">OffPlan</th>
              <th className="text-right px-4 py-2.5 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Δ only meaningful when both sides have values AND we have a
              // valid baseline. For one-sided rows or no-baseline state, show "—".
              const bothSides = hasValidBaseline && r.hist != null && r.offplan != null;
              const delta = bothSides ? r.offplan - r.hist : null;
              const deltaClass = delta == null ? 'text-stone-300' : delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-rose-700' : 'text-stone-500';
              const showHist = hasValidBaseline && r.hist != null;
              return (
                <tr key={r.key} className="border-b border-stone-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-900">{r.label}</div>
                    <div className="text-[11px] text-stone-500 mt-1 leading-relaxed">
                      {hasValidBaseline && (
                        <div><span className="font-semibold text-stone-600">Historical:</span> {r.histDetail}</div>
                      )}
                      <div className={hasValidBaseline ? 'mt-0.5' : ''}><span className="font-semibold text-stone-600">OffPlan:</span> {r.offplanDetail}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono num">
                    {showHist ? fmtUSD(r.hist) : <span className="text-stone-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono num">
                    {r.offplan == null ? <span className="text-stone-300">—</span> : fmtUSD(r.offplan)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono num ${deltaClass}`}>
                    {delta == null ? '—' : fmtDelta(delta)}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-stone-50 font-semibold">
              <td className="px-4 py-3 text-stone-900">
                <div>Total</div>
                <div className="text-[11px] text-stone-500 font-normal mt-0.5">
                  {hasValidBaseline ? 'Current Total Spend vs OffPlan Stack · Δ = net savings' : 'OffPlan stack only — baseline not entered'}
                </div>
              </td>
              <td className="px-4 py-3 text-right font-mono num">
                {hasValidBaseline ? fmtUSD(savingsBaseline) : <span className="text-stone-300">—</span>}
              </td>
              <td className="px-4 py-3 text-right font-mono num">
                <div>{fmtUSD(totalOffPlanAnnual)}</div>
                <div className="text-[11px] text-stone-500 font-normal font-mono num">{fmtUSD(totalOffPlanPEPM, 2)} PEPM</div>
              </td>
              <td className={`px-4 py-3 text-right font-mono num ${totalDelta == null ? 'text-stone-300' : totalDelta <= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {totalDelta == null ? '—' : (
                  <>
                    <div>{fmtDelta(totalDelta)}</div>
                    {savingsPct != null && (
                      <div className="text-[11px] font-normal">{fmtPct(savingsPct)}</div>
                    )}
                  </>
                )}
              </td>
            </tr>
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

      {hasValidBaseline && display.mode === 'bundled' && (
        <div className="mt-4 border border-stone-200 rounded">
          <button
            onClick={() => setShowInside((s) => !s)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50 transition rounded-t text-sm"
          >
            {showInside ? <ChevronDown size={14} className="text-stone-500" /> : <ChevronRight size={14} className="text-stone-500" />}
            <span className="font-medium text-stone-900">{display.insideTitle}</span>
            <span className="text-xs text-stone-500 normal-case font-normal ml-auto">
              Synthetic breakdown — not separate cash flows
            </span>
          </button>
          {showInside && (
            <div className="px-4 pb-4 pt-1 border-t border-stone-200 text-xs text-stone-600 leading-relaxed space-y-3">
              <p>
                The carrier prices the {display.bundledLabel.toLowerCase()} to cover their expected claims plus admin, UM/CM, stop-loss reinsurance, and margin. The employer writes one check; the breakdown below is the carrier's internal allocation, reconstructed from the historical claims figure entered in Setup.
              </p>
              <div className="border border-stone-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="px-3 py-2 text-stone-700">Carrier-paid claims (utilization)</td>
                      <td className="px-3 py-2 text-right font-mono num">{fmtUSD(histClaims)}</td>
                      <td className="px-3 py-2 text-right text-stone-500 font-mono num w-20">{savingsBaseline > 0 ? fmtPct(histClaims / savingsBaseline) : '—'}</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="px-3 py-2 text-stone-700">Carrier overhead + margin (load)</td>
                      <td className="px-3 py-2 text-right font-mono num">{fmtUSD(histLoad)}</td>
                      <td className="px-3 py-2 text-right text-stone-500 font-mono num">{savingsBaseline > 0 ? fmtPct(histLoad / savingsBaseline) : '—'}</td>
                    </tr>
                    <tr className="bg-stone-50 font-semibold">
                      <td className="px-3 py-2 text-stone-900">Bundled {display.bundledLabel.toLowerCase()}</td>
                      <td className="px-3 py-2 text-right font-mono num">{fmtUSD(savingsBaseline)}</td>
                      <td className="px-3 py-2 text-right font-mono num text-stone-500">100%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-stone-500">
                Going OffPlan replaces the bundled premium with the three OffPlan line items above. Most of the savings come from eliminating the carrier load — the OffPlan stack replaces it with transparently-priced DPC, stop-loss, indemnity, and plan admin from separate vendors.
              </p>
            </div>
          )}
        </div>
      )}

      {hasValidBaseline && (
        <div className="mt-3 text-[11px] text-stone-500 leading-relaxed">
          <strong>Funding-model note:</strong> {display.note}
        </div>
      )}
    </div>
  );
}

// Signed currency formatter for deltas. Positive values get a leading "+";
// fmtUSD already renders negatives with a minus sign.
function fmtDelta(v) {
  const n = Number(v) || 0;
  if (n > 0) return `+${fmtUSD(n)}`;
  return fmtUSD(n);
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

function KPICard({ icon: Icon, accent, label, value, sub, tooltip }) {
  const accents = {
    stone:   "text-stone-700 bg-stone-100",
    emerald: "text-emerald-700 bg-emerald-100",
    blue:    "text-blue-700 bg-blue-100",
    violet:  "text-violet-700 bg-violet-100",
    amber:   "text-amber-700 bg-amber-100",
    rose:    "text-rose-700 bg-rose-100",
  };
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4 group relative" title={tooltip || undefined}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded grid place-items-center ${accents[accent]}`}>
          <Icon size={12} />
        </div>
        <div className="text-[10px] uppercase tracking-wider text-stone-500 font-medium">{label}</div>
      </div>
      <div className="font-mono num text-2xl text-stone-900 mb-1">{value}</div>
      <div className="text-xs text-stone-500">{sub}</div>
      {tooltip && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-stone-900 text-white text-xs rounded p-2.5 leading-relaxed shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
          {tooltip}
        </div>
      )}
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
