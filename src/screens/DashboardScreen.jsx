import { useMemo } from 'react';
import { AlertTriangle, DollarSign, TrendingDown, Zap, Activity, Shield, Target, Users } from 'lucide-react';
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
            <strong>Prototype scope: deterministic classification layer only.</strong>
            <div className="mt-1 leading-relaxed">
              This reference implementation produces the residual fund (the dollars that remain after every OffPlan transformation) and the OffPlan stack PEPM. The headline capital output specified in Master Spec v3.3 — <strong>Minimum Required Liquidity</strong> with bootstrap confidence bands — is computed by the stochastic capital layer (Modules 6, 7, 9, 10, 11 per Liquidity Spec v1.2) which is not yet implemented in this prototype. The "Risk Margin × Residual" formula shown below is the deprecated v3.0/v3.1 funding construct retained here only as an intermediate placeholder until the stochastic layer ships.
            </div>
          </div>
        </div>
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
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
            Min Required Liquidity <span className="text-amber-300 font-normal">· not yet computed</span>
          </div>
          <div className="font-display text-5xl mb-1 num text-stone-500">—</div>
          <div className="text-sm text-stone-400">
            Produced by stochastic layer (Modules 6–11) · not in this prototype
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

      <div className="bg-white border border-stone-200 rounded-lg p-6 mb-6">
        <h3 className="font-medium text-stone-900 mb-1">Where the historical claims went</h3>
        <p className="text-xs text-stone-500 mb-5">
          Each segment shows what happened to that portion of the original {fmtUSD(a.historical_claims)} in claims.
        </p>
        <FlowChart aggregates={a} historical={a.historical_claims} />
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
