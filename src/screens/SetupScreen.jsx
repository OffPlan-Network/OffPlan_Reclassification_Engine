import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Field } from '../ui/Field.jsx';
import { fmtUSD } from '../ui/formatters.js';

export function SetupScreen({ initial, onSave }) {
  const [form, setForm] = useState(initial || {
    id: `EMP_${Date.now()}`,
    name: "",
    industry: "",
    state: "",
    employee_count: "",
    covered_lives: "",
    current_funding_model: "",
    historical_claims_spend: "",
    current_total_healthcare_spend: "",
    baseline_spend_type: "",
    includes_stop_loss: false,
    includes_admin_fees: false,
    includes_broker_fees: false,
    baseline_confidence: "medium",
    current_pepm: "",
    claims_period_start: "2025-01-01",
    claims_period_end: "2025-12-31",
    plan_type: "Fully Insured",
    created_at: Date.now(),
  });

  const set = (k, v) => setForm({ ...form, [k]: v });

  useEffect(() => {
    if (!form.current_funding_model) return;
    const map = {
      fully_insured: { plan: "Fully Insured", btype: "total_premium" },
      level_funded:  { plan: "Level Funded",  btype: "level_funded_contribution" },
      self_funded:   { plan: "Self Funded",   btype: "total_plan_cost" },
      unsure:        { plan: form.plan_type,  btype: "" },
    }[form.current_funding_model];
    if (map) setForm((f) => ({ ...f, plan_type: map.plan, baseline_spend_type: map.btype }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.current_funding_model]);

  const computedPEPM = useMemo(() => {
    const spend = Number(form.current_total_healthcare_spend) || 0;
    const lives = Number(form.covered_lives) || 0;
    if (!spend || !lives) return 0;
    return spend / lives / 12;
  }, [form.current_total_healthcare_spend, form.covered_lives]);

  const isValid =
    form.name &&
    form.covered_lives &&
    form.current_funding_model &&
    form.current_total_healthcare_spend &&
    form.historical_claims_spend;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Employer Setup</h1>
      <p className="text-stone-600 mb-8">
        Establish baseline facts. These anchor the entire reclassification analysis.
      </p>

      <div className="bg-white border border-stone-200 rounded-lg p-8 space-y-6">
        <Field label="Employer Name" required>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ABC Manufacturing"
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Industry">
            <select
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
            >
              <option value="">Select industry</option>
              {["Manufacturing", "Construction", "Professional Services", "Hospitality", "Retail",
                "Healthcare", "Technology", "Finance", "Logistics", "Other"].map(x =>
                <option key={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="State">
            <input
              value={form.state}
              onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))}
              placeholder="GA"
              maxLength={2}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900 uppercase"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Employees" required>
            <input
              type="number" value={form.employee_count}
              onChange={(e) => set("employee_count", e.target.value)}
              placeholder="75"
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
            />
          </Field>
          <Field label="Covered Lives" required tooltip="Includes employees and dependents">
            <input
              type="number" value={form.covered_lives}
              onChange={(e) => set("covered_lives", e.target.value)}
              placeholder="162"
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
            />
          </Field>
        </div>

        <div className="border-t border-stone-200 pt-6 mt-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Baseline · Two Questions
          </div>
          <h3 className="font-display text-2xl text-stone-900 mb-1">How healthcare is paid for today</h3>
          <p className="text-xs text-stone-500 mb-5 max-w-xl leading-relaxed">
            Savings are calculated against current total healthcare spend, not claims-only spend.
            For fully insured employers, use total annual premium. For self-funded employers,
            include claims paid, TPA fees, network access fees, stop-loss premium, PBM/admin fees,
            and other plan costs.
          </p>

          <Field label="Question 1 · Current Funding Model" required>
            <div className="grid grid-cols-4 gap-2">
              {[
                { v: "fully_insured", l: "Fully Insured", s: "Carrier-billed premium" },
                { v: "level_funded",  l: "Level Funded",  s: "Premium + claims fund" },
                { v: "self_funded",   l: "Self Funded",   s: "Pays claims + admin" },
                { v: "unsure",        l: "Unsure",        s: "Confirm with broker" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => set("current_funding_model", opt.v)}
                  className={`text-left rounded border p-3 transition ${
                    form.current_funding_model === opt.v
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 bg-stone-50 hover:border-stone-400"
                  }`}
                >
                  <div className="font-medium text-sm">{opt.l}</div>
                  <div className={`text-[11px] mt-0.5 ${form.current_funding_model === opt.v ? "text-stone-300" : "text-stone-500"}`}>{opt.s}</div>
                </button>
              ))}
            </div>
          </Field>

          <div className="mt-5">
            <Field
              label={
                form.current_funding_model === "fully_insured"
                  ? "Question 2 · Total Annual Premium"
                  : form.current_funding_model === "self_funded"
                  ? "Question 2 · Total Annual Plan Cost"
                  : form.current_funding_model === "level_funded"
                  ? "Question 2 · Total Annual Level-Funded Contribution"
                  : "Question 2 · Current Total Healthcare Spend"
              }
              required
              tooltip={
                form.current_funding_model === "fully_insured"
                  ? "Sum of all premium paid to carrier for medical/Rx"
                  : form.current_funding_model === "self_funded"
                  ? "Claims paid + stop-loss + TPA + network + PBM/admin + broker"
                  : form.current_funding_model === "level_funded"
                  ? "Includes expected claims fund, stop-loss, admin, carrier/TPA fees"
                  : "Total annual healthcare spend, all-in"
              }
            >
              <input
                type="number"
                value={form.current_total_healthcare_spend}
                onChange={(e) => set("current_total_healthcare_spend", e.target.value)}
                placeholder="1187450"
                className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
              />
            </Field>
          </div>

          {(form.current_funding_model === "self_funded" || form.current_funding_model === "level_funded") && (
            <div className="mt-4 bg-stone-50 border border-stone-200 rounded p-4">
              <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-2">
                Confirm what is included in the figure above
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {[
                  ["includes_stop_loss",  "Stop-loss premium"],
                  ["includes_admin_fees", "TPA / PBM / admin fees"],
                  ["includes_broker_fees", "Broker / consultant fees"],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!form[k]}
                      onChange={(e) => set(k, e.target.checked)}
                      className="rounded border-stone-300"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 items-center">
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">Baseline confidence</label>
                <select
                  value={form.baseline_confidence}
                  onChange={(e) => set("baseline_confidence", e.target.value)}
                  className="bg-white border border-stone-200 rounded px-2 h-9 text-sm"
                >
                  <option value="high">High · Confirmed by broker/CFO</option>
                  <option value="medium">Medium · Reasonable estimate</option>
                  <option value="low">Low · Rough placeholder</option>
                </select>
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-4">
            <Field
              label="Historical Claims Spend (12 mo)"
              required
              tooltip="Medical + Rx + facility + professional. Used for reclassification modeling, not for savings."
            >
              <input
                type="number"
                value={form.historical_claims_spend}
                onChange={(e) => set("historical_claims_spend", e.target.value)}
                placeholder="950000"
                className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 num focus:outline-none focus:border-stone-900 font-mono"
              />
            </Field>
            <Field label="Current PEPM (from baseline)">
              <div className="w-full bg-stone-100 border border-stone-200 rounded px-3 h-11 flex items-center text-stone-600 font-mono num">
                {fmtUSD(computedPEPM, 2)}
              </div>
            </Field>
          </div>

          {Number(form.historical_claims_spend) > 0 &&
           Number(form.current_total_healthcare_spend) > 0 &&
           Number(form.historical_claims_spend) > Number(form.current_total_healthcare_spend) && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 flex gap-2">
              <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                Historical claims exceed current total spend. Double-check that Question 2 reflects total healthcare cost (premium or full plan cost), not just claims.
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Claims Period Start">
            <input
              type="date" value={form.claims_period_start}
              onChange={(e) => set("claims_period_start", e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
            />
          </Field>
          <Field label="Claims Period End">
            <input
              type="date" value={form.claims_period_end}
              onChange={(e) => set("claims_period_end", e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900"
            />
          </Field>
        </div>

        <div className="flex justify-end pt-2">
          <button
            disabled={!isValid}
            onClick={() => onSave({
              ...form,
              current_pepm: computedPEPM,
            })}
            className="bg-stone-900 text-white px-6 h-11 rounded font-medium hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Save and Continue
          </button>
        </div>
      </div>
    </div>
  );
}
