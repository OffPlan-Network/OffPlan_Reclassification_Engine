import { useState } from 'react';
import { Plus, Check, X, Trash2 } from 'lucide-react';
import { BucketBadge } from '../ui/BucketBadge.jsx';

export function AdminScreen({ cptRules, cashPrices, indemnityBenefits, repriceFactors,
                               pricingVersions, ruleVersions, indemnityVersions, benchmarkVersions, auditLog,
                               onUpdateCashPrices, onUpdateIndemnity, onUpdateRepriceFactors }) {
  const [tab, setTab] = useState("cash");

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Admin Control</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Configure the economic assumptions that drive every calculation. Every change creates a new immutable version. Past versions are never deleted.
      </p>

      <div className="flex border border-stone-200 rounded overflow-hidden mb-6 inline-flex">
        {[
          { id: "cash", label: "Cash-Pay Pricing" },
          { id: "indemnity", label: "Indemnity Benefits" },
          { id: "reprice", label: "Default Repricing" },
          { id: "rules", label: "CPT Rules" },
          { id: "versions", label: "Versions" },
          { id: "audit", label: "Audit Log" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 h-10 text-sm font-medium ${
              tab === t.id ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cash" && <CashPriceTable cashPrices={cashPrices} onChange={onUpdateCashPrices} />}
      {tab === "indemnity" && <IndemnityTable indemnityBenefits={indemnityBenefits} onChange={onUpdateIndemnity} />}
      {tab === "reprice" && <RepriceFactorTable factors={repriceFactors} onChange={onUpdateRepriceFactors} />}
      {tab === "rules" && <CPTRulesTable rules={cptRules} />}
      {tab === "versions" && (
        <VersionsTable
          pricingVersions={pricingVersions}
          ruleVersions={ruleVersions}
          indemnityVersions={indemnityVersions}
          benchmarkVersions={benchmarkVersions}
        />
      )}
      {tab === "audit" && <AuditLogTable entries={auditLog} />}
    </div>
  );
}

function VersionsTable({ pricingVersions, ruleVersions, indemnityVersions, benchmarkVersions }) {
  const groups = [
    { title: "Pricing Versions", subtitle: "Cash-pay reference prices", versions: pricingVersions },
    { title: "Rule Versions", subtitle: "CPT/POS/specialty bucket mapping + repricing factors", versions: ruleVersions },
    { title: "Indemnity Versions", subtitle: "Cash benefit schedule (ER, hospital, imaging, ambulance)", versions: indemnityVersions },
    { title: "Benchmark Versions", subtitle: "Mode 3 modeled distributions", versions: benchmarkVersions },
  ];
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.title} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
            <h3 className="font-medium text-stone-900">{g.title}</h3>
            <p className="text-xs text-stone-500">{g.subtitle}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
              <tr>
                <th className="text-left px-5 py-2">Version</th>
                <th className="text-left px-5 py-2">Status</th>
                <th className="text-left px-5 py-2">Effective</th>
                <th className="text-left px-5 py-2">Created By</th>
                <th className="text-left px-5 py-2">Change Summary</th>
              </tr>
            </thead>
            <tbody>
              {(g.versions || []).map((v) => (
                <tr key={v.id} className="border-b border-stone-100">
                  <td className="px-5 py-3 font-mono text-xs">{v.version_label}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-medium ${
                      v.status === "active" ? "bg-emerald-100 text-emerald-800" :
                      v.status === "draft" ? "bg-amber-100 text-amber-800" :
                      "bg-stone-100 text-stone-600"
                    }`}>{v.status}</span>
                  </td>
                  <td className="px-5 py-3 text-stone-700">{new Date(v.effective_at).toISOString().slice(0, 10)}</td>
                  <td className="px-5 py-3 text-stone-700">{v.created_by}</td>
                  <td className="px-5 py-3 text-stone-600 text-xs">{v.change_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function AuditLogTable({ entries }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium text-stone-900">Audit Log</h3>
        <p className="text-xs text-stone-500">Append-only. {entries.length} entries.</p>
      </div>
      {entries.length === 0 ? (
        <div className="px-5 py-12 text-center text-stone-500 text-sm">No audit entries yet. Admin actions will appear here.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
            <tr>
              <th className="text-left px-5 py-2">When</th>
              <th className="text-left px-5 py-2">Actor</th>
              <th className="text-left px-5 py-2">Action</th>
              <th className="text-left px-5 py-2">Entity</th>
              <th className="text-left px-5 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-stone-100">
                <td className="px-5 py-3 text-xs font-mono text-stone-600">{new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="px-5 py-3 text-stone-700">{e.actor_user_id} <span className="text-stone-400">· {e.actor_role}</span></td>
                <td className="px-5 py-3">
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-medium">{e.action}</span>
                </td>
                <td className="px-5 py-3 text-stone-700 text-xs">{e.entity_type} · <span className="font-mono text-stone-500">{(e.entity_id || "").slice(0, 18)}</span></td>
                <td className="px-5 py-3 text-stone-600 text-xs">{e.change_reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CashPriceTable({ cashPrices, onChange }) {
  const [adding, setAdding] = useState(false);
  const [newCpt, setNewCpt] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const update = (cpt, price) => onChange({ ...cashPrices, [cpt]: Number(price) });
  const remove = (cpt) => {
    const next = { ...cashPrices };
    delete next[cpt];
    onChange(next);
  };
  const add = () => {
    if (!newCpt || !newPrice) return;
    onChange({ ...cashPrices, [newCpt]: Number(newPrice) });
    setNewCpt(""); setNewPrice(""); setAdding(false);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">Cash-Pay Reference Prices</h3>
        <button onClick={() => setAdding(true)} className="text-sm flex items-center gap-1 text-stone-700 hover:text-stone-900">
          <Plus size={14} /> Add CPT
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
          <tr>
            <th className="text-left px-5 py-2">CPT Code</th>
            <th className="text-right px-5 py-2">Cash Price</th>
            <th className="px-5 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {adding && (
            <tr className="border-b border-stone-100 bg-blue-50">
              <td className="px-5 py-2"><input value={newCpt} onChange={(e) => setNewCpt(e.target.value)} placeholder="CPT" className="w-24 border border-stone-300 rounded px-2 h-7 text-xs font-mono" /></td>
              <td className="px-5 py-2 text-right"><input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0" className="w-24 border border-stone-300 rounded px-2 h-7 text-xs font-mono num text-right" /></td>
              <td className="px-5 py-2 text-right">
                <button onClick={add} className="text-emerald-700 mr-2"><Check size={14} /></button>
                <button onClick={() => setAdding(false)} className="text-stone-500"><X size={14} /></button>
              </td>
            </tr>
          )}
          {Object.entries(cashPrices).sort(([a], [b]) => a.localeCompare(b)).map(([cpt, price]) => (
            <tr key={cpt} className="border-b border-stone-100 hover:bg-stone-50">
              <td className="px-5 py-2 font-mono text-xs">{cpt}</td>
              <td className="px-5 py-2 text-right">
                <input
                  type="number" value={price}
                  onChange={(e) => update(cpt, e.target.value)}
                  className="w-24 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <button onClick={() => remove(cpt)} className="text-stone-400 hover:text-red-600"><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndemnityTable({ indemnityBenefits, onChange }) {
  const update = (event, field, value) => {
    onChange({
      ...indemnityBenefits,
      [event]: { ...indemnityBenefits[event], [field]: Number(value) },
    });
  };
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">Indemnity Benefit Schedule</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
          <tr>
            <th className="text-left px-5 py-2">Event Type</th>
            <th className="text-right px-5 py-2">Benefit Amount</th>
            <th className="text-right px-5 py-2">Max Per Year</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(indemnityBenefits).map(([event, b]) => (
            <tr key={event} className="border-b border-stone-100">
              <td className="px-5 py-2 font-medium">{event}</td>
              <td className="px-5 py-2 text-right">
                <input type="number" value={b.benefit}
                  onChange={(e) => update(event, "benefit", e.target.value)}
                  className="w-28 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <input type="number" value={b.maxPerYear}
                  onChange={(e) => update(event, "maxPerYear", e.target.value)}
                  className="w-20 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepriceFactorTable({ factors, onChange }) {
  const update = (cat, value) => onChange({ ...factors, [cat]: Number(value) });
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">Default Repricing Factors</h3>
        <p className="text-xs text-stone-500 mt-0.5">Applied when no specific cash price exists. Lower factor means deeper discount.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
          <tr>
            <th className="text-left px-5 py-2">Category</th>
            <th className="text-right px-5 py-2">Factor (% of allowed)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(factors).map(([cat, f]) => (
            <tr key={cat} className="border-b border-stone-100">
              <td className="px-5 py-2 font-medium">{cat}</td>
              <td className="px-5 py-2 text-right">
                <input type="number" step="0.05" min="0.1" max="1" value={f}
                  onChange={(e) => update(cat, e.target.value)}
                  className="w-20 border border-stone-200 rounded px-2 h-7 text-xs font-mono num text-right bg-transparent focus:bg-stone-50"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CPTRulesTable({ rules }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50">
        <h3 className="font-medium">CPT Classification Rules</h3>
        <p className="text-xs text-stone-500 mt-0.5">Read-only in MVP. Future versions support adding custom CPT ranges.</p>
      </div>
      <div className="max-h-[600px] overflow-y-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200 sticky top-0 bg-white">
            <tr>
              <th className="text-left px-5 py-2">CPT Range</th>
              <th className="text-left px-5 py-2">Category</th>
              <th className="text-left px-5 py-2">Bucket</th>
              <th className="text-left px-5 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i} className="border-b border-stone-100">
                <td className="px-5 py-2 font-mono text-xs">{r.range[0]}–{r.range[1]}</td>
                <td className="px-5 py-2">{r.category}</td>
                <td className="px-5 py-2"><BucketBadge bucket={r.bucket} small /></td>
                <td className="px-5 py-2 text-stone-600 text-xs">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
