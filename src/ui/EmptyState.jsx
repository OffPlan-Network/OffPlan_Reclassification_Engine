export function EmptyState({ title, description, ctaLabel, onAction }) {
  return (
    <div className="border border-dashed border-stone-300 rounded-lg p-16 text-center bg-white/50">
      <h3 className="font-display text-2xl text-stone-900 mb-2">{title}</h3>
      <p className="text-stone-600 max-w-md mx-auto mb-6">{description}</p>
      {ctaLabel && (
        <button onClick={onAction} className="bg-stone-900 text-white px-5 h-11 rounded font-medium hover:bg-stone-800">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
