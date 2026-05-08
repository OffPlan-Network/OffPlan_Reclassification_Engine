import { useMemo, useState } from 'react';
import { Loader2, Droplets, Copy, Upload as UploadIcon, Check, X } from 'lucide-react';
import { Field } from '../ui/Field.jsx';
import { fmtUSD, fmtPct, fmtNum } from '../ui/formatters.js';
import {
  SCENARIO_PRESETS,
  OFFPLAN_FIXED_OVERHEAD_PEPM,
} from '../constants.js';
import { useLiquidity } from '../hooks/useLiquidity.js';

export function ScenarioScreen({ scenario, employer, result, classifiedClaims, onChange, onPreset }) {
  const set = (k, v) => onChange({ ...scenario, [k]: v });

  // Live preview math. Mirrors DashboardScreen logic so the user sees the
  // same headline numbers updating as they move sliders, without having
  // to navigate over to Dashboard.
  const lives = Math.max(1, Number(employer?.covered_lives) || 1);
  const a = result?.aggregates;
  const residualFund = a?.residual_fund ?? 0;
  const residualPEPM = residualFund / lives / 12;
  const recommendedPEPM = residualPEPM * (Number(scenario.risk_margin) || 1);
  const totalOffPlanPEPM =
    OFFPLAN_FIXED_OVERHEAD_PEPM + (Number(scenario.stop_loss_pepm) || 0) + recommendedPEPM;
  const totalOffPlanAnnual = totalOffPlanPEPM * lives * 12;
  const rawBaseline = Number(employer?.current_total_healthcare_spend);
  const hasBaseline = rawBaseline > 0;
  const annualSavings = hasBaseline ? rawBaseline - totalOffPlanAnnual : null;
  const savingsPct = hasBaseline && rawBaseline > 0 ? annualSavings / rawBaseline : null;

  const { liquidity, loading: liquidityLoading } = useLiquidity({
    employer,
    scenario,
    modeledClaims: result?.claims,
  });

  // Detect whether the active scenario matches one of the presets exactly
  // so we can show "(modified)" when it doesn't.
  const matchedPresetKey = useMemo(() => {
    const cmpKeys = Object.keys(scenario).filter((k) => k !== 'name' && k !== 'description');
    for (const [key, preset] of Object.entries(SCENARIO_PRESETS)) {
      const matches = cmpKeys.every((k) => {
        if (typeof scenario[k] === 'number') return Math.abs((scenario[k] ?? 0) - (preset[k] ?? 0)) < 1e-6;
        return scenario[k] === preset[k];
      });
      if (matches) return key;
    }
    return null;
  }, [scenario]);

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Scenario Controls</h1>
      <p className="text-stone-600 mb-6 max-w-2xl">
        Adjust assumptions to see how each lever affects the deterministic classification output, the OffPlan stack, and the stochastic Min Required Liquidity. The headline numbers above the controls update live as you move sliders.
      </p>

      {/* Live preview headline strip — same numbers the Dashboard hero shows */}
      <LivePreview
        residualFund={residualFund}
        residualPEPM={residualPEPM}
        totalOffPlanPEPM={totalOffPlanPEPM}
        totalOffPlanAnnual={totalOffPlanAnnual}
        annualSavings={annualSavings}
        savingsPct={savingsPct}
        hasBaseline={hasBaseline}
        liquidity={liquidity}
        liquidityLoading={liquidityLoading}
        hasResult={!!result}
      />

      <div className="grid grid-cols-3 gap-3 mb-8">
        {Object.entries(SCENARIO_PRESETS).map(([key, p]) => {
          const isActive = matchedPresetKey === key;
          return (
            <button
              key={key}
              onClick={() => onPreset(key)}
              className={`text-left p-4 rounded-lg border transition ${
                isActive
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-white border-stone-200 hover:border-stone-400"
              }`}
            >
              <div className="font-medium mb-1 flex items-center justify-between">
                <span>{p.name}</span>
                {isActive && <span className="text-[10px] uppercase tracking-wider text-emerald-300">Active</span>}
              </div>
              <div className={`text-xs ${isActive ? "text-stone-300" : "text-stone-600"}`}>
                {p.description}
              </div>
            </button>
          );
        })}
      </div>

      {!matchedPresetKey && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-6 text-xs text-amber-900 flex items-center justify-between">
          <span>Active scenario differs from all three presets — currently <strong>{scenario.name} (modified)</strong>.</span>
          <button
            onClick={() => {
              const keyToReset = scenario.name?.toLowerCase() || 'expected';
              if (SCENARIO_PRESETS[keyToReset]) onPreset(keyToReset);
              else onPreset('expected');
            }}
            className="underline hover:no-underline"
          >
            Reset to {scenario.name}
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* ============= Reduction Levers ============= */}
        <Section title="Reduction Levers" subtitle="How aggressively the OffPlan model compresses each cost bucket">
          <Slider
            label="DPC Elimination"
            tooltip="Share of bucket A (Primary Care, Lab) absorbed into the DPC membership"
            value={scenario.dpc_elimination_pct} min={0} max={1} step={0.05}
            format={(v) => fmtPct(v, 0)}
            onChange={(v) => set("dpc_elimination_pct", v)}
          />
          <Slider
            label="Urgent Care Reduction"
            tooltip="Reduction in urgent care utilization due to same-day DPC access"
            value={scenario.urgent_care_reduction_pct} min={0} max={1} step={0.05}
            format={(v) => fmtPct(v, 0)}
            onChange={(v) => set("urgent_care_reduction_pct", v)}
          />
          <Slider
            label="ER Reduction"
            tooltip="Avoidable ER visits prevented by DPC access and chronic care management"
            value={scenario.er_reduction_pct} min={0} max={1} step={0.05}
            format={(v) => fmtPct(v, 0)}
            onChange={(v) => set("er_reduction_pct", v)}
          />
          <Slider
            label="Cash-Pay Discount Factor"
            tooltip="Default repriced cost as fraction of original allowed amount (lower = bigger discount). Routine maternity (T11) inherits this factor."
            value={scenario.cashpay_discount_factor} min={0.2} max={1} step={0.05}
            format={(v) => fmtPct(v, 0)}
            onChange={(v) => set("cashpay_discount_factor", v)}
          />
        </Section>

        {/* ============= Stop-Loss + Risk Layer ============= */}
        <Section title="Stop-Loss & Risk Layer" subtitle="Specific + aggregate stop-loss configuration">
          <div className="grid grid-cols-2 gap-6">
            <Field label="Specific Stop-Loss Attachment Point" tooltip="Member-aggregate threshold above which claims shift to the stop-loss carrier">
              <input
                type="number" value={scenario.attachment_point}
                onChange={(e) => set("attachment_point", Number(e.target.value))}
                className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
              />
            </Field>
            <Field label="Stop-Loss PEPM (estimate)" tooltip="Specific stop-loss premium per employee per month">
              <input
                type="number" value={scenario.stop_loss_pepm}
                onChange={(e) => set("stop_loss_pepm", Number(e.target.value))}
                data-testid="scenario-stop-loss-pepm"
                className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
              />
            </Field>
          </div>

          <div className="border-t border-stone-100 pt-4">
            <Toggle
              label="Aggregate Stop-Loss Corridor"
              checked={!!scenario.aggregate_stop_loss_enabled}
              onChange={(v) => set("aggregate_stop_loss_enabled", v)}
              tooltip="When enabled, total annual residual above expected × attachment_pct is reimbursed at year-end. Caps employer aggregate exposure across the whole year."
            />
            {scenario.aggregate_stop_loss_enabled && (
              <div className="mt-4">
                <Slider
                  label="Aggregate Attachment %"
                  tooltip="Fraction of expected residual that triggers aggregate corridor. 1.25 = corridor reimburses anything above 125% of underwritten residual."
                  value={scenario.aggregate_attachment_pct ?? 1.25} min={1.0} max={2.0} step={0.05}
                  format={(v) => `${v.toFixed(2)}×`}
                  onChange={(v) => set("aggregate_attachment_pct", v)}
                />
              </div>
            )}
          </div>
        </Section>

        {/* ============= Clinical Layer ============= */}
        <Section title="Clinical & Indemnity Layer" subtitle="DPC clinical effect on chronic clustering + complications, plus indemnity benefits">
          <Slider
            label="DPC Clinical Mitigation"
            tooltip="Single knob that scales both per-tier complication probability and chronic-clustering uplift by (1 − this factor). Models DPC's monthly-membership absorbing chronic management and PCP catching complication early-warnings. 0 = no clinical effect modeled; higher = stronger DPC mitigation."
            value={scenario.dpc_clinical_mitigation_pct ?? 0} min={0} max={0.6} step={0.05}
            format={(v) => fmtPct(v, 0)}
            onChange={(v) => set("dpc_clinical_mitigation_pct", v)}
          />
          <div className="pt-2">
            <Toggle
              label="Indemnity Layer Enabled"
              checked={!!scenario.indemnity_enabled}
              onChange={(v) => set("indemnity_enabled", v)}
              tooltip="Cash benefits offset ER, hospital admit, hospital day, outpatient surgery, imaging events. Reduces residual on triggering events."
            />
          </div>
        </Section>

        {/* ============= Deprecated Funding Placeholder ============= */}
        <Section title="Deprecated Funding Placeholder" subtitle="Risk Margin × Residual — v3.0/v3.1 funding construct, retained until stochastic MRL fully replaces it">
          <Slider
            label="Risk Margin"
            tooltip="v3.0/v3.1 deterministic margin on residual_pepm to size the claims fund. Replaced in production by P95 of max cumulative drawdown from the stochastic simulator (above)."
            value={scenario.risk_margin} min={1.0} max={1.6} step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set("risk_margin", v)}
          />
        </Section>

        {/* ============= Export / Import ============= */}
        <Section title="Export & Import" subtitle="Copy this scenario as JSON to share with a colleague, or paste a JSON block to apply someone else's tuning.">
          <ExportImportControls scenario={scenario} onApply={onChange} />
        </Section>
      </div>
    </div>
  );
}

function ExportImportControls({ scenario, onApply }) {
  const [copied, setCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState(null);

  const json = useMemo(() => JSON.stringify(scenario, null, 2), [scenario]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: select the textarea content for manual copy
      const ta = document.createElement('textarea');
      ta.value = json; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
      document.body.removeChild(ta);
    }
  };

  const apply = () => {
    setImportError(null);
    let parsed;
    try { parsed = JSON.parse(importText); }
    catch (err) { setImportError(`Invalid JSON: ${err.message}`); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setImportError('Expected a JSON object with scenario knobs');
      return;
    }
    if (typeof parsed.dpc_elimination_pct !== 'number' || typeof parsed.attachment_point !== 'number') {
      setImportError('Pasted JSON does not look like a scenario (missing dpc_elimination_pct or attachment_point)');
      return;
    }
    onApply({ ...scenario, ...parsed });
    setImportOpen(false);
    setImportText('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={copy}
          className="flex items-center gap-2 bg-stone-900 text-white px-4 h-9 rounded text-sm font-medium hover:bg-stone-800"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
        <button
          onClick={() => { setImportOpen(true); setImportError(null); }}
          className="flex items-center gap-2 border border-stone-300 text-stone-700 px-4 h-9 rounded text-sm font-medium hover:bg-stone-50"
        >
          <UploadIcon size={14} />
          Import from JSON
        </button>
      </div>

      {/* Read-only preview of current scenario JSON */}
      <details className="border border-stone-200 rounded">
        <summary className="px-3 py-2 cursor-pointer text-xs text-stone-600 hover:bg-stone-50 select-none">
          Preview JSON ({Object.keys(scenario).length} fields)
        </summary>
        <pre className="bg-stone-900 text-stone-100 text-[11px] font-mono p-4 overflow-auto rounded-b max-h-60">{json}</pre>
      </details>

      {importOpen && (
        <div className="border border-stone-300 rounded-lg bg-stone-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-stone-900">Paste scenario JSON</div>
            <button
              onClick={() => { setImportOpen(false); setImportText(''); setImportError(null); }}
              className="text-stone-400 hover:text-stone-700"
            >
              <X size={14} />
            </button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{"dpc_elimination_pct": 0.85, ... }'
            rows={8}
            className="w-full bg-white border border-stone-200 rounded px-3 py-2 font-mono text-xs focus:outline-none focus:border-stone-900"
            autoFocus
          />
          {importError && (
            <div className="mt-2 text-xs text-rose-700">{importError}</div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={apply}
              disabled={!importText.trim()}
              className="bg-stone-900 text-white px-4 h-9 rounded text-sm font-medium hover:bg-stone-800 disabled:opacity-30"
            >
              Apply scenario
            </button>
            <span className="text-[11px] text-stone-500">Pasted fields override the active scenario; unspecified fields keep current values.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LivePreview({ residualFund, residualPEPM, totalOffPlanPEPM, totalOffPlanAnnual, annualSavings, savingsPct, hasBaseline, liquidity, liquidityLoading, hasResult }) {
  if (!hasResult) {
    return (
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-6 mb-8 text-sm text-stone-600">
        Load claims data first to see live scenario impact. Knobs below still save, but headline numbers won't compute until claims are classified.
      </div>
    );
  }
  return (
    <div className="bg-stone-900 text-white rounded-lg p-6 mb-8 grid grid-cols-2 md:grid-cols-4 gap-5">
      <PreviewMetric
        label="Residual Fund · Annual"
        value={fmtUSD(residualFund)}
        sub={`${fmtUSD(residualPEPM, 2)} PEPM`}
      />
      <PreviewMetric
        label="OffPlan Total"
        value={fmtUSD(totalOffPlanAnnual)}
        sub={`${fmtUSD(totalOffPlanPEPM, 2)} PEPM`}
      />
      <PreviewMetric
        label="Net Savings"
        value={hasBaseline ? fmtUSD(annualSavings) : "—"}
        sub={hasBaseline ? `${fmtPct(savingsPct)} reduction` : "Set baseline in Setup"}
        accent={hasBaseline ? (annualSavings >= 0 ? "emerald" : "rose") : "stone"}
      />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2 flex items-center gap-1.5">
          <Droplets size={12} className="text-blue-300" />
          MRL · P95
        </div>
        <div className="font-display text-3xl mb-1 num flex items-center gap-2">
          {liquidityLoading ? (
            <Loader2 size={18} className="animate-spin text-stone-400" />
          ) : liquidity ? (
            fmtUSD(liquidity.mrl)
          ) : (
            "—"
          )}
        </div>
        <div className="text-xs text-stone-300">
          {liquidity?.cer ? `CER ${liquidity.cer.toFixed(1)}× vs ELF` : `${fmtNum(liquidity?.meta?.runs || 0)} runs`}
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({ label, value, sub, accent = "stone" }) {
  const accentColor = accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">{label}</div>
      <div className={`font-display text-3xl mb-1 num ${accentColor}`}>{value}</div>
      <div className="text-xs text-stone-300">{sub}</div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-6">
      <div className="mb-5 pb-3 border-b border-stone-100">
        <h3 className="font-display text-xl text-stone-900">{title}</h3>
        {subtitle && <p className="text-xs text-stone-500 mt-1">{subtitle}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Slider({ label, tooltip, value, min, max, step, format, onChange }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-900">{label}</div>
          {tooltip && <div className="text-xs text-stone-500 mt-0.5 leading-relaxed">{tooltip}</div>}
        </div>
        <div className="font-mono num text-lg text-stone-900 shrink-0">{format(value)}</div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-stone-900"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange, tooltip }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 accent-stone-900"
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-stone-900">{label}</div>
        {tooltip && <div className="text-xs text-stone-500 mt-0.5 leading-relaxed">{tooltip}</div>}
      </div>
    </label>
  );
}
