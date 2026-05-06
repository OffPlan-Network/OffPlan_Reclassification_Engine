import { INPUT_MODES } from '../constants.js';

export function InputModeBadge({ inputModeRecord, inline = false }) {
  if (!inputModeRecord) return null;
  const m = INPUT_MODES[inputModeRecord.mode?.toUpperCase()] || { label: inputModeRecord.mode, confidence: "low" };
  const colors = {
    high:   { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-200", dot: "bg-emerald-500" },
    medium: { bg: "bg-amber-50",   text: "text-amber-800",   border: "border-amber-200",   dot: "bg-amber-500" },
    low:    { bg: "bg-rose-50",    text: "text-rose-800",    border: "border-rose-200",    dot: "bg-rose-500" },
  }[inputModeRecord.confidence_override || m.confidence] || { bg: "bg-stone-50", text: "text-stone-700", border: "border-stone-200", dot: "bg-stone-400" };
  return (
    <span className={`${colors.bg} ${colors.text} ${colors.border} border ${inline ? "inline-flex" : "flex"} items-center gap-1.5 text-[11px] uppercase tracking-wider px-2 py-1 rounded font-medium`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {m.label} · {(inputModeRecord.confidence_override || m.confidence)} confidence
    </span>
  );
}

export function ProvenanceFooter({ inputModeRecord, pricingVersion, ruleVersion, indemnityVersion, benchmarkVersion, scenario, claims, compact = false }) {
  if (!inputModeRecord && !pricingVersion) return null;
  const m = inputModeRecord ? (INPUT_MODES[inputModeRecord.mode?.toUpperCase()] || { label: inputModeRecord.mode }) : null;
  const overrideCount = (claims || []).filter((c) => c.manual_override).length;
  const lines = [
    { label: "Mode", value: m ? m.label : "Unknown" },
    { label: "Confidence", value: inputModeRecord ? (inputModeRecord.confidence_override || m.confidence) + (inputModeRecord.confidence_override ? " (user-overridden)" : "") : "—" },
    { label: "Pricing", value: pricingVersion ? `${pricingVersion.version_label} · effective ${new Date(pricingVersion.effective_at).toISOString().slice(0,10)}` : "—" },
    { label: "Rules", value: ruleVersion ? `${ruleVersion.version_label} · effective ${new Date(ruleVersion.effective_at).toISOString().slice(0,10)}` : "—" },
    { label: "Indemnity", value: indemnityVersion ? `${indemnityVersion.version_label}` : "—" },
    ...(inputModeRecord?.mode === "modeled" && benchmarkVersion ? [{ label: "Benchmark", value: benchmarkVersion.version_label }] : []),
    { label: "Scenario", value: scenario?.name ? `${scenario.name}` : "—" },
    { label: "Overrides", value: overrideCount > 0 ? `${overrideCount} manual override${overrideCount === 1 ? "" : "s"} applied` : "none" },
  ];

  if (compact) {
    return (
      <div className="text-[10px] text-stone-500 leading-relaxed">
        {lines.map((l, i) => (
          <span key={i}>
            <span className="font-medium text-stone-600">{l.label}:</span> {l.value}
            {i < lines.length - 1 ? "  ·  " : ""}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="border-t border-stone-200 pt-4 mt-6">
      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-2">Provenance</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
        {lines.map((l, i) => (
          <div key={i}>
            <div className="text-stone-500 uppercase tracking-wider">{l.label}</div>
            <div className="text-stone-800 font-mono">{l.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
