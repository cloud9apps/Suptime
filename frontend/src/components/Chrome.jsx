export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="px-6 md:px-10 pt-8 pb-6 border-b border-white/10 flex items-start justify-between gap-6 flex-wrap">
      <div className="min-w-0">
        {eyebrow && (
          <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40 mb-3">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-white/50 mt-2 max-w-xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function StatusDot({ status }) {
  const color =
    status === "up"
      ? "#00FF66"
      : status === "down"
      ? "#FF3366"
      : status === "warning"
      ? "#FFCC00"
      : "#6B7280";
  return (
    <span
      className="inline-block w-2 h-2"
      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

export function Metric({ label, value, tone = "default", testid }) {
  const toneCls =
    tone === "up"
      ? "text-[#00FF66]"
      : tone === "down"
      ? "text-[#FF3366]"
      : tone === "warn"
      ? "text-[#FFCC00]"
      : "text-white";
  return (
    <div className="p-6 border-b md:border-b-0 md:border-r border-white/[0.06] last:border-r-0">
      <div className="font-mono-s text-[10px] tracking-[0.25em] uppercase text-white/40 mb-3">
        {label}
      </div>
      <div className={`font-display text-4xl font-bold ${toneCls}`} data-testid={testid}>
        {value}
      </div>
    </div>
  );
}
