import { AlertTriangle, FileDown, Droplets } from 'lucide-react';
import { fmtUSD, fmtNum, fmtPct } from '../ui/formatters.js';
import { BucketBadge } from '../ui/BucketBadge.jsx';
import { InputModeBadge, ProvenanceFooter } from '../ui/Provenance.jsx';
import {
  SCENARIO_PRESETS,
  OFFPLAN_MEMBERSHIP_PEPM,
  TPA_PEPM,
  PBM_ADMIN_PEPM,
  FIRSTHEALTH_PEPM,
  MEDWATCH_PEPM,
  ACCIDENT_INDEMNITY_PEPM,
} from '../constants.js';
import { useLiquidity } from '../hooks/useLiquidity.js';

export function ReportScreen({ employer, scenario, result, classifiedClaims, inputModeRecord,
                                activePricingVersion, activeRuleVersion, activeIndemnityVersion, activeBenchmarkVersion }) {
  if (!result || !employer) return <div className="text-stone-500">No data to report.</div>;

  const a = result.aggregates;
  const lives = Number(employer.covered_lives) || 1;
  const residualPEPM = a.residual_fund / lives / 12;
  const recommendedPEPM = residualPEPM * scenario.risk_margin;
  const totalOffPlanPEPM =
    OFFPLAN_MEMBERSHIP_PEPM +
    PBM_ADMIN_PEPM +
    FIRSTHEALTH_PEPM +
    MEDWATCH_PEPM +
    ACCIDENT_INDEMNITY_PEPM +
    TPA_PEPM +
    scenario.stop_loss_pepm +
    recommendedPEPM;
  const totalOffPlanAnnual = totalOffPlanPEPM * lives * 12;
  const rawBaseline = Number(employer.current_total_healthcare_spend);
  const hasValidBaseline = rawBaseline > 0;
  const savingsBaseline = hasValidBaseline ? rawBaseline : null;
  const annualSavings = hasValidBaseline ? savingsBaseline - totalOffPlanAnnual : null;
  const savingsPct = hasValidBaseline && savingsBaseline > 0 ? annualSavings / savingsBaseline : null;

  // Same hook as the Dashboard so both screens share the cached server-side
  // simulation when on the API backend, and the inline 1K-run computation
  // when on localStorage.
  const { liquidity, loading: liquidityLoading } = useLiquidity({
    employer,
    scenario,
    modeledClaims: result?.claims,
  });

  const print = () => window.print();

  if (!hasValidBaseline) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Report</h1>
          <p className="text-stone-600">Employer-ready output. Export as PDF via your browser.</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-6 max-w-2xl">
          <div className="flex gap-3">
            <AlertTriangle size={20} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-rose-900 mb-2">
                Current Total Healthcare Spend is required before the report can be generated.
              </div>
              <p className="text-sm text-rose-900 leading-relaxed mb-3">
                Historical claims are used only for reclassification modeling and cannot be used as the savings baseline. To produce a defensible savings report, the employer's Current Total Healthcare Spend (annual premium for fully insured, total plan cost for self-funded) must be entered in the Setup screen.
              </p>
              <p className="text-xs text-rose-800">
                This safeguard prevents the report from displaying savings figures derived from an inappropriate comparison basis.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Report</h1>
          <p className="text-stone-600">Employer-ready output. Export as PDF via your browser.</p>
        </div>
        <button
          onClick={print}
          className="bg-stone-900 text-white px-5 h-11 rounded font-medium hover:bg-stone-800 flex items-center gap-2"
        >
          <FileDown size={16} /> Export PDF
        </button>
      </div>

      <div id="report-doc" className="bg-white border border-stone-200 rounded-lg p-12 print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-center justify-between border-b border-stone-300 pb-6 mb-8">
          <div>
            <div className="font-display text-3xl">OffPlan</div>
            <div className="text-xs uppercase tracking-[0.18em] text-stone-500">
              Claims Reclassification Report
            </div>
          </div>
          <div className="text-right text-xs text-stone-500 space-y-2">
            <div>Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            <div>Confidential</div>
            {inputModeRecord && (
              <div className="flex justify-end">
                <InputModeBadge inputModeRecord={inputModeRecord} inline />
              </div>
            )}
          </div>
        </div>

        <h1 className="font-display text-5xl text-stone-900 mb-2 leading-tight">
          {employer.name}
        </h1>
        <div className="text-sm text-stone-600 mb-8">
          {employer.industry || "—"} · {employer.state} · {fmtNum(employer.covered_lives)} covered lives
          · Period: {employer.claims_period_start} to {employer.claims_period_end}
        </div>

        <p className="text-base text-stone-800 leading-relaxed mb-8 max-w-3xl">
          The historical claims data shows {fmtUSD(a.historical_claims)} in spend across {fmtNum(result.claims.length)} line items.
          Under the OffPlan model, the majority of this spend is no longer processed as claims at all.
          The headline output of this analysis is the capital requirement: how much liquidity an employer must hold to operate safely. The intermediate residual fund (the dollars that survive every transformation) feeds the stochastic layer, which produces the final Minimum Required Liquidity number.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-8 text-xs text-amber-900 leading-relaxed">
          <strong>Prototype scope:</strong> This report shows the deterministic classification layer of the OffPlan engine — the residual fund and the OffPlan stack PEPM. The headline capital output specified in OffPlan's engine spec (Minimum Required Liquidity with bootstrap confidence bands, Capital Efficiency Ratio, Liquidity Coverage Ratio) is produced by the stochastic capital layer which is under development and not represented in this prototype output. Numbers below are intermediate and intended for engine demonstration purposes.
        </div>

        <div className="bg-stone-900 text-white rounded-lg p-8 mb-10">
          <div className="grid grid-cols-3 gap-8">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual Fund · Intermediate</div>
              <div className="font-display text-4xl mb-1 num">{fmtUSD(a.residual_fund)}</div>
              <div className="text-xs text-stone-400">vs {fmtUSD(a.historical_claims)} historical claims · feeds stochastic layer</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Residual PEPM · Pre-Stochastic</div>
              <div className="font-display text-4xl mb-1 num">{fmtUSD(residualPEPM, 2)}</div>
              <div className="text-xs text-stone-400">deprecated v3.0 placeholder: {fmtUSD(recommendedPEPM, 2)} with {scenario.risk_margin.toFixed(2)}x margin</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">Net Annual Savings</div>
              <div className={`font-display text-4xl mb-1 num ${annualSavings >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtUSD(annualSavings)}</div>
              <div className="text-xs text-stone-400">{fmtPct(savingsPct)} vs current total spend</div>
            </div>
          </div>
        </div>

        <div className="border border-stone-200 rounded-lg p-5 mb-10 bg-stone-50">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-2">Comparison Basis</div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Current Funding Model</td>
                <td className="py-2 text-right font-medium">{employer.plan_type || "—"}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Historical Claims (modeling input)</td>
                <td className="py-2 text-right font-mono num">{fmtUSD(a.historical_claims)}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Current Total Healthcare Spend (savings baseline)</td>
                <td className="py-2 text-right font-mono num">{fmtUSD(savingsBaseline)}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">OffPlan Total Stack</td>
                <td className="py-2 text-right font-mono num">{fmtUSD(totalOffPlanAnnual)}</td>
              </tr>
              <tr>
                <td className="py-2 font-semibold text-stone-900">Net Savings</td>
                <td className={`py-2 text-right font-mono num font-semibold ${annualSavings >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmtUSD(annualSavings)} ({fmtPct(savingsPct)})
                </td>
              </tr>
            </tbody>
          </table>
          <div className="text-[11px] text-stone-500 mt-3 leading-relaxed">
            Savings are calculated against current total healthcare spend, not claims-only spend.
            For fully insured employers, this is total annual premium. For self-funded employers, this includes
            claims paid, TPA fees, network access, stop-loss premium, PBM/admin fees, and other plan costs.
          </div>
        </div>

        <h2 className="font-display text-3xl mb-1">Reclassification Detail</h2>
        <p className="text-sm text-stone-600 mb-5">
          Every dollar of historical spend has been routed to one of five outcomes.
        </p>
        <table className="w-full text-sm border border-stone-200 rounded mb-10">
          <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
            <tr>
              <th className="text-left px-4 py-3 border-b border-stone-200">Bucket</th>
              <th className="text-left px-4 py-3 border-b border-stone-200">Treatment</th>
              <th className="text-right px-4 py-3 border-b border-stone-200">Amount</th>
              <th className="text-right px-4 py-3 border-b border-stone-200">% of Historical</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="A" /></td>
              <td className="px-4 py-3">Eliminated through DPC membership</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.dpc_eliminated)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct(a.dpc_eliminated / a.historical_claims)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="B" /></td>
              <td className="px-4 py-3">Cash-pay repriced (specialty, imaging, procedures)</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.repriced_savings)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct(a.repriced_savings / a.historical_claims)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="C" /></td>
              <td className="px-4 py-3">ER reduction + indemnity cash benefits</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.er_reduction_savings + a.indemnity_offset)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct((a.er_reduction_savings + a.indemnity_offset) / a.historical_claims)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="E" /></td>
              <td className="px-4 py-3">Shifted to stop-loss (above attachment point)</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(a.stop_loss_shift)}</td>
              <td className="px-4 py-3 text-right font-mono num text-stone-500">{fmtPct(a.stop_loss_shift / a.historical_claims)}</td>
            </tr>
            <tr className="bg-amber-50 border-b border-stone-100">
              <td className="px-4 py-3"><BucketBadge bucket="D" /></td>
              <td className="px-4 py-3 font-medium">Residual: requires funding as claims</td>
              <td className="px-4 py-3 text-right font-mono num font-medium">{fmtUSD(a.residual_fund)}</td>
              <td className="px-4 py-3 text-right font-mono num font-medium">{fmtPct(a.residual_fund / a.historical_claims)}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="font-display text-3xl mb-1">Total Cost Stack</h2>
        <p className="text-sm text-stone-600 mb-5">
          What the employer pays per employee per month under OffPlan.
        </p>
        <table className="w-full text-sm border border-stone-200 rounded mb-10">
          <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
            <tr>
              <th className="text-left px-4 py-3 border-b border-stone-200">Component</th>
              <th className="text-left px-4 py-3 border-b border-stone-200">Function</th>
              <th className="text-right px-4 py-3 border-b border-stone-200">PEPM</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">OffPlan DPC Membership (adult)</td>
              <td className="px-4 py-3 text-stone-600">Unlimited primary care, chronic management, navigation · locked</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(OFFPLAN_MEMBERSHIP_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">PBM Admin</td>
              <td className="px-4 py-3 text-stone-600">Transparent pass-through PBM admin · working assumption (Yuzu RFP)</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(PBM_ADMIN_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">FirstHealth Network Access</td>
              <td className="px-4 py-3 text-stone-600">OOA fallback network · Yuzu rate card</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(FIRSTHEALTH_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">MedWatch UM/CM</td>
              <td className="px-4 py-3 text-stone-600">Inpatient + outpatient utilization & case management · Yuzu rate card</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(MEDWATCH_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">Accident + Hospital Indemnity</td>
              <td className="px-4 py-3 text-stone-600">Gap event funding · working assumption</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(ACCIDENT_INDEMNITY_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">TPA (Yuzu)</td>
              <td className="px-4 py-3 text-stone-600">Claims administration for non-DPC services · confirmed</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(TPA_PEPM, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">Stop-Loss</td>
              <td className="px-4 py-3 text-stone-600">Catastrophic protection above {fmtUSD(scenario.attachment_point)} · finalize at quote</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(scenario.stop_loss_pepm, 2)}</td>
            </tr>
            <tr className="border-b border-stone-100">
              <td className="px-4 py-3 font-medium">Claims Fund · placeholder</td>
              <td className="px-4 py-3 text-stone-600">Residual PEPM × {scenario.risk_margin.toFixed(2)}x margin · v3.0 deterministic placeholder; production replaces with stochastic Min Required Liquidity ($200 PMPM working anchor)</td>
              <td className="px-4 py-3 text-right font-mono num">{fmtUSD(recommendedPEPM, 2)}</td>
            </tr>
            <tr className="bg-stone-50 border-b border-stone-100 font-medium">
              <td className="px-4 py-3">Total OffPlan PEPM</td>
              <td className="px-4 py-3 text-stone-600">Per employee per month · doc anchor $582.20 (expected)</td>
              <td className="px-4 py-3 text-right font-mono num text-lg">{fmtUSD(totalOffPlanPEPM, 2)}</td>
            </tr>
          </tbody>
        </table>

        {liquidity && (
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-1">
              <Droplets size={18} className="text-blue-600" />
              <h2 className="font-display text-3xl">Liquidity Profile</h2>
            </div>
            <p className="text-sm text-stone-600 mb-5 max-w-3xl">
              Distribution of max cumulative drawdown across {fmtNum(liquidity.meta.runs)} simulation runs.
              Method: timing-resample of deterministic claims plus a Pareto-distributed catastrophic event overlay
              {liquidity.tail?.enabled
                ? <> (λ={liquidity.tail.lambda_per_member_year} per member-year, scale={fmtUSD(liquidity.tail.pareto_scale)}, shape={liquidity.tail.pareto_shape})</>
                : <> (overlay disabled)</>
              }, {liquidity.meta.lag_months}-month stop-loss reimbursement lag. P95 = MRL.
              Chronic clustering, complication lag, NegBin frequency, and aggregate stop-loss are still deferred
              per Liquidity Spec v1.2 — see README §11.
            </p>
            <table className="w-full text-sm border border-stone-200 rounded mb-4">
              <tbody>
                <AssumptionRow label="Min Required Liquidity (P95)" value={fmtUSD(liquidity.mrl)} />
                <AssumptionRow label="P50 / P75 / P90 / P99" value={`${fmtUSD(liquidity.percentiles.p50)} · ${fmtUSD(liquidity.percentiles.p75)} · ${fmtUSD(liquidity.percentiles.p90)} · ${fmtUSD(liquidity.percentiles.p99)}`} />
                <AssumptionRow label="Mean Monthly Outflow" value={fmtUSD(liquidity.mean_monthly_outflow)} />
                <AssumptionRow label="Capital Efficiency Ratio (ELF / MRL)" value={liquidity.cer ? `${liquidity.cer.toFixed(1)}×` : "—"} />
                <AssumptionRow label="Liquidity Reduction" value={liquidity.liquidity_reduction_pct != null ? fmtPct(liquidity.liquidity_reduction_pct) : "—"} />
                <AssumptionRow label="Liquidity Coverage Ratio (MRL / mean monthly outflow)" value={liquidity.lcr ? `${liquidity.lcr.toFixed(1)}×` : "—"} />
                <AssumptionRow label="Stress Coverage Ratio (MRL / P75)" value={liquidity.scr ? `${liquidity.scr.toFixed(1)}×` : "—"} />
                <AssumptionRow label="Equivalent Level-Funded Total Cost (ELF)" value={fmtUSD(liquidity.elf)} />
                {liquidity.tail?.enabled && (
                  <>
                    <AssumptionRow
                      label="Tail overlay · expected events / yr"
                      value={liquidity.tail.expected_events_per_year.toFixed(2)}
                    />
                    <AssumptionRow
                      label="Tail overlay · observed events / run (avg)"
                      value={liquidity.tail.observed_events_per_run.toFixed(2)}
                    />
                  </>
                )}
                <AssumptionRow label="Method" value={liquidity.meta.method} />
              </tbody>
            </table>
          </div>
        )}

        <h2 className="font-display text-3xl mb-1">Scenario Assumptions</h2>
        <p className="text-sm text-stone-600 mb-5">
          {scenario.name} scenario. {SCENARIO_PRESETS[scenario.name?.toLowerCase()]?.description || ""}
        </p>
        <table className="w-full text-sm border border-stone-200 rounded mb-10">
          <tbody>
            <AssumptionRow label="DPC Elimination" value={fmtPct(scenario.dpc_elimination_pct)} />
            <AssumptionRow label="Urgent Care Reduction" value={fmtPct(scenario.urgent_care_reduction_pct)} />
            <AssumptionRow label="ER Reduction" value={fmtPct(scenario.er_reduction_pct)} />
            <AssumptionRow label="Cash-Pay Discount Factor" value={fmtPct(scenario.cashpay_discount_factor)} />
            <AssumptionRow label="Indemnity Layer" value={scenario.indemnity_enabled ? "Enabled" : "Disabled"} />
            <AssumptionRow label="Stop-Loss Attachment Point" value={fmtUSD(scenario.attachment_point)} />
            <AssumptionRow label="Stop-Loss PEPM" value={fmtUSD(scenario.stop_loss_pepm, 2)} />
            <AssumptionRow label="Risk Margin (deprecated · placeholder only)" value={`${scenario.risk_margin.toFixed(2)}x`} />
          </tbody>
        </table>

        <div className="border-t border-stone-300 pt-6 text-xs text-stone-500 leading-relaxed">
          <strong className="text-stone-700">Important: </strong>
          This report combines the deterministic classification layer with the v1 stochastic liquidity layer. It is not an insurance quote. The MRL number above is derived from {liquidity ? fmtNum(liquidity.meta.runs) : "1,000"} Monte Carlo runs combining timing variance over deterministic claims with a Pareto-distributed catastrophic event overlay. Chronic clustering, complication lags, NegBin frequency for over-dispersed tiers, and aggregate stop-loss specified in OffPlan's Liquidity & Capital Modeling Specification v1.2 are still deferred. Treat MRL as a directional CFO conversation tool, not as an MGU underwriting submission. Stop-loss premiums, attachment points, and indemnity benefits are illustrative and must be confirmed with underwriting partners. The "Risk Margin" multiplier is the deprecated v3.0/v3.1 deterministic funding placeholder, retained for scenario sizing only.
        </div>

        <div className="border-t border-stone-200 pt-4 mt-4">
          <ProvenanceFooter
            inputModeRecord={inputModeRecord}
            pricingVersion={activePricingVersion}
            ruleVersion={activeRuleVersion}
            indemnityVersion={activeIndemnityVersion}
            benchmarkVersion={activeBenchmarkVersion}
            scenario={scenario}
            claims={classifiedClaims}
            compact
          />
        </div>
      </div>
    </div>
  );
}

function AssumptionRow({ label, value }) {
  return (
    <tr className="border-b border-stone-100">
      <td className="px-4 py-2.5 text-stone-600">{label}</td>
      <td className="px-4 py-2.5 text-right font-mono num">{value}</td>
    </tr>
  );
}
