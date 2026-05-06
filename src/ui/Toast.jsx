import { Check, AlertCircle } from 'lucide-react';

export function Toast({ message, type }) {
  const colors = {
    success: "bg-emerald-900 text-emerald-100",
    error: "bg-red-900 text-red-100",
    info: "bg-stone-900 text-stone-100",
  };
  const Icon = type === "success" ? Check : type === "error" ? AlertCircle : null;
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${colors[type] || colors.info} px-4 py-2.5 rounded shadow-lg flex items-center gap-2 text-sm`}>
      {Icon && <Icon size={14} />}
      {message}
    </div>
  );
}
