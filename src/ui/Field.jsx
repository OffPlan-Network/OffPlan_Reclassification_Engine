export function Field({ label, children, required, tooltip }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-stone-600 font-medium mb-1.5 flex items-center gap-1">
        {label}
        {required && <span className="text-red-600">*</span>}
        {tooltip && <span className="text-stone-400 normal-case font-normal tracking-normal">· {tooltip}</span>}
      </label>
      {children}
    </div>
  );
}
