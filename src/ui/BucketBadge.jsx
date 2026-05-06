export function BucketBadge({ bucket, small }) {
  const map = {
    A: { label: "A · DPC", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    B: { label: "B · Repriced", color: "bg-blue-100 text-blue-800 border-blue-200" },
    C: { label: "C · Indemnity", color: "bg-violet-100 text-violet-800 border-violet-200" },
    D: { label: "D · Residual", color: "bg-amber-100 text-amber-800 border-amber-200" },
    E: { label: "E · Stop-Loss", color: "bg-rose-100 text-rose-800 border-rose-200" },
  };
  const x = map[bucket] || { label: "—", color: "bg-stone-100 text-stone-600 border-stone-200" };
  return (
    <span className={`inline-flex items-center font-medium border rounded ${x.color} ${small ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5"}`}>
      {x.label}
    </span>
  );
}
