import { Field } from '../ui/Field.jsx';
import { fmtPct } from '../ui/formatters.js';
import { SCENARIO_PRESETS } from '../constants.js';

export function ScenarioScreen({ scenario, onChange, onPreset }) {
  const set = (k, v) => onChange({ ...scenario, [k]: v });

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Scenario Controls</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Adjust assumptions to see how each lever affects the deterministic classification output and the OffPlan stack components. Outputs recalculate live. Note: in production, the stochastic layer replaces the Risk Margin placeholder with simulation-based Min Required Liquidity.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {Object.entries(SCENARIO_PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => onPreset(key)}
            className={`text-left p-4 rounded-lg border transition ${
              scenario.name === p.name
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white border-stone-200 hover:border-stone-400"
            }`}
          >
            <div className="font-medium mb-1">{p.name}</div>
            <div className={`text-xs ${scenario.name === p.name ? "text-stone-300" : "text-stone-600"}`}>
              {p.description}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-8 space-y-6">
        <h3 className="font-display text-2xl mb-2">Levers</h3>

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
          tooltip="Default repriced cost as fraction of original allowed amount (lower = bigger discount)"
          value={scenario.cashpay_discount_factor} min={0.2} max={1} step={0.05}
          format={(v) => fmtPct(v, 0)}
          onChange={(v) => set("cashpay_discount_factor", v)}
        />

        <div className="grid grid-cols-2 gap-6 pt-2">
          <Field label="Specific Stop-Loss Attachment Point">
            <input
              type="number" value={scenario.attachment_point}
              onChange={(e) => set("attachment_point", Number(e.target.value))}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
            />
          </Field>
          <Field label="Stop-Loss PEPM (estimate)">
            <input
              type="number" value={scenario.stop_loss_pepm}
              onChange={(e) => set("stop_loss_pepm", Number(e.target.value))}
              data-testid="scenario-stop-loss-pepm"
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
            />
          </Field>
        </div>

        <Slider
          label="Risk Margin (deprecated — placeholder until stochastic layer ships)"
          tooltip="v3.0/v3.1 deterministic margin. Replaced in production by P95 of max rolling 30-day Net Drawdown from the stochastic simulator. Adjust here only for scenario-sizing demos."
          value={scenario.risk_margin} min={1.0} max={1.6} step={0.05}
          format={(v) => `${v.toFixed(2)}x`}
          onChange={(v) => set("risk_margin", v)}
        />

        <div className="flex items-center gap-3 pt-4 border-t border-stone-200">
          <input
            type="checkbox"
            checked={scenario.indemnity_enabled}
            onChange={(e) => set("indemnity_enabled", e.target.checked)}
            id="indemnity_enabled"
            className="w-4 h-4"
          />
          <label htmlFor="indemnity_enabled" className="text-sm">
            <span className="font-medium">Indemnity layer enabled</span>
            <span className="text-stone-500"> · cash benefits offset ER, hospital, imaging events</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, tooltip, value, min, max, step, format, onChange }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-stone-900">{label}</div>
          {tooltip && <div className="text-xs text-stone-500 mt-0.5">{tooltip}</div>}
        </div>
        <div className="font-mono num text-lg text-stone-900">{format(value)}</div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-stone-900"
      />
    </div>
  );
}
