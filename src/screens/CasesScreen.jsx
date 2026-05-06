import { useState } from 'react';
import { Plus, ArrowRight, Trash2, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { fmtUSD, fmtNum } from '../ui/formatters.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { DEMO_CASES } from '../demo-cases.js';

export function CasesScreen({ employers, loading, onOpen, onCreateNew, onDelete, onLoadDemo, onResetAll, isPersistent }) {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (!confirm("Wipe all locally-saved cases, scenarios, admin overrides, and audit log? This cannot be undone.")) return;
    setResetting(true);
    try { await onResetAll?.(); } finally { setResetting(false); }
  };

  return (
    <div>
      <DemoBanner isPersistent={isPersistent} />

      <div className="flex items-end justify-between mb-6 gap-6 flex-wrap">
        <div>
          <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">
            Employer Cases
          </h1>
          <p className="text-stone-600 max-w-2xl">
            Each case represents one employer's claims being reconstructed under the OffPlan model.
            Upload claims, adjust assumptions, and produce the deterministic classification output (residual fund, OffPlan stack PEPM, savings vs current spend). The stochastic capital layer (Minimum Required Liquidity, CER, LCR, SCR) is specified in the Liquidity &amp; Capital Modeling Spec v1.2 and not yet computed in this prototype.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            disabled={resetting}
            title="Wipe all locally-saved demo data"
            className="flex items-center gap-2 border border-stone-300 text-stone-700 px-4 h-11 rounded font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {resetting ? "Resetting…" : "Reset demo data"}
          </button>
          <button
            onClick={onCreateNew}
            className="flex items-center gap-2 bg-stone-900 text-white px-5 h-11 rounded font-medium hover:bg-stone-800 transition"
          >
            <Plus size={16} strokeWidth={2.5} />
            New Case
          </button>
        </div>
      </div>

      {DEMO_CASES.length > 0 && (
        <DemoCasePanel demoCases={DEMO_CASES} onLoadDemo={onLoadDemo} loading={loading} />
      )}

      <div className="mt-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold">
            Your saved cases
          </h2>
          <span className="text-xs text-stone-400">
            {employers.length} case{employers.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <div className="text-stone-500">Loading…</div>
        ) : employers.length === 0 ? (
          <EmptyState
            title="No saved cases yet"
            description="Load one of the demo cases above to see the engine end-to-end, or create a new case from scratch with your own claims data."
            ctaLabel="Create your first case"
            onAction={onCreateNew}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employers.map((e) => (
              <EmployerCard key={e.id} employer={e} onOpen={() => onOpen(e.id)} onDelete={() => onDelete(e.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DemoBanner({ isPersistent }) {
  const [collapsed, setCollapsed] = useState(false);
  if (collapsed) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8 flex items-start gap-3">
      <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <div className="font-medium text-amber-900 mb-1">
          Static demo · No backend · Not for PHI
        </div>
        <div className="text-amber-800 leading-relaxed">
          This is the OffPlan Reclassification Engine reference implementation running entirely in your browser. All calculation, classification, and persistence happens client-side
          {isPersistent ? " using your browser's localStorage" : " in-memory only (your browser blocked localStorage)"}.
          {" "}Do not load real protected health information. The bundled demo cases use synthetic and benchmark-derived data only. Production deployment requires the backend calculation service, multi-tenant database, and SOC 2 / HIPAA controls described in the Architecture &amp; Security Specification v1.0.
        </div>
      </div>
      <button
        onClick={() => setCollapsed(true)}
        className="text-amber-700 hover:text-amber-900 p-1"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function DemoCasePanel({ demoCases, onLoadDemo, loading }) {
  const [pending, setPending] = useState(null);

  const handleLoad = async (demoCase) => {
    if (pending) return;
    setPending(demoCase.id);
    try { await onLoadDemo?.(demoCase); } finally { setPending(null); }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
            Prebuilt demo cases
          </div>
          <h2 className="font-display text-2xl text-stone-900">
            One-click employer scenarios
          </h2>
        </div>
        <p className="text-xs text-stone-500 max-w-md">
          Each case loads a different input mode (Full Claims, Partial Summary, Modeled Profile) and
          a sensible scenario preset, so you can compare confidence levels and the cascade output.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {demoCases.map((dc) => (
          <DemoCaseCard
            key={dc.id}
            demoCase={dc}
            onLoad={() => handleLoad(dc)}
            loading={loading || pending === dc.id}
            disabled={!!pending && pending !== dc.id}
          />
        ))}
      </div>
    </div>
  );
}

function DemoCaseCard({ demoCase, onLoad, loading, disabled }) {
  const modeColor = {
    synthetic_full: { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-200" },
    csv_partial:    { bg: "bg-amber-50",   text: "text-amber-800",   border: "border-amber-200" },
    rows_partial:   { bg: "bg-amber-50",   text: "text-amber-800",   border: "border-amber-200" },
    modeled:        { bg: "bg-rose-50",    text: "text-rose-800",    border: "border-rose-200" },
  }[demoCase.loader?.kind] || { bg: "bg-stone-50", text: "text-stone-800", border: "border-stone-200" };

  return (
    <div className={`border ${modeColor.border} rounded-lg p-4 flex flex-col`}>
      <span className={`${modeColor.bg} ${modeColor.text} self-start text-[10px] uppercase tracking-wider px-2 py-0.5 rounded mb-3`}>
        {demoCase.tagline}
      </span>
      <h3 className="font-medium text-stone-900 mb-1">{demoCase.label}</h3>
      <p className="text-xs text-stone-600 leading-relaxed mb-4 flex-1">
        {demoCase.blurb}
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4 text-[11px]">
        <div>
          <div className="uppercase tracking-wider text-stone-500">Lives</div>
          <div className="font-mono num text-stone-800">{fmtNum(demoCase.employer?.covered_lives)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-stone-500">Total spend</div>
          <div className="font-mono num text-stone-800">{fmtUSD(demoCase.employer?.current_total_healthcare_spend)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-stone-500">State</div>
          <div className="text-stone-800">{demoCase.employer?.state}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider text-stone-500">Scenario</div>
          <div className="text-stone-800 capitalize">{demoCase.scenario}</div>
        </div>
      </div>
      <button
        onClick={onLoad}
        disabled={loading || disabled}
        className="w-full bg-stone-900 text-white h-10 rounded text-sm font-medium hover:bg-stone-800 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading ? "Loading…" : (
          <>
            Load case
            <ArrowRight size={14} />
          </>
        )}
      </button>
    </div>
  );
}

function EmployerCard({ employer, onOpen, onDelete }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5 hover:border-stone-400 transition group">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-stone-900 truncate">{employer.name}</h3>
          <div className="text-xs text-stone-500 mt-0.5">
            {employer.industry || "—"} · {employer.state || "—"}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm("Delete this case?")) onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-600 transition"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Stat label="Covered Lives" value={fmtNum(employer.covered_lives)} />
        <Stat label="Total Spend" value={Number(employer.current_total_healthcare_spend) > 0 ? fmtUSD(employer.current_total_healthcare_spend) : "—"} />
      </div>
      <button
        onClick={onOpen}
        className="w-full text-sm text-stone-700 hover:text-stone-900 flex items-center justify-between border-t border-stone-100 pt-3"
      >
        <span>Open case</span>
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-0.5">{label}</div>
      <div className="font-mono text-sm text-stone-900 num">{value}</div>
    </div>
  );
}
