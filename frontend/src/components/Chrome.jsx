export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[#0B0C10]/75 px-6 md:px-10 pt-7 pb-5 border-b border-white/10 flex items-start justify-between gap-6 flex-wrap">
      <div className="min-w-0 rise">
        {eyebrow && (
          <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-[#00E5FF]/80 mb-2.5">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-slate-400 mt-2 max-w-xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex gap-2 items-center">{actions}</div>}
    </div>
  );
}

const DOT = {
  up: "#00E676",
  down: "#FF1744",
  warning: "#FFC400",
  info: "#00E5FF",
  unknown: "#64748B",
};

export function StatusDot({ status }) {
  const color = DOT[status] || DOT.unknown;
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: color, boxShadow: `0 0 8px ${color}, 0 0 2px ${color}` }}
    />
  );
}

export function StatusBadge({ status, children }) {
  const color = DOT[status] || DOT.unknown;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-mono-s text-[10px] uppercase tracking-wider border"
      style={{ color, borderColor: `${color}33`, background: `${color}14` }}
    >
      <StatusDot status={status} />
      {children}
    </span>
  );
}

const TILE = {
  up: { color: "#00E676", glow: "rgba(0,230,118,0.18)" },
  down: { color: "#FF1744", glow: "rgba(255,23,68,0.18)" },
  warn: { color: "#FFC400", glow: "rgba(255,196,0,0.18)" },
  info: { color: "#00E5FF", glow: "rgba(0,229,255,0.18)" },
  brand: { color: "#B388FF", glow: "rgba(179,136,255,0.18)" },
  default: { color: "#F8FAFC", glow: "rgba(255,255,255,0.08)" },
};

export function Metric({ label, value, tone = "default", testid, icon: Icon }) {
  const t = TILE[tone] || TILE.default;
  return (
    <div
      className="glass-card glass-card-hover relative p-5 md:p-6 group"
      style={{ "--glow": t.glow }}
    >
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-60 group-hover:opacity-100 transition-opacity"
        style={{ background: t.glow }}
      />
      <div className="relative flex items-center justify-between font-mono-s text-[10px] tracking-[0.25em] uppercase text-slate-400 mb-4">
        {label}
        {Icon && <Icon className="w-4 h-4" style={{ color: t.color }} strokeWidth={1.75} />}
      </div>
      <div
        className="relative font-display text-4xl md:text-5xl font-bold tracking-tight"
        data-testid={testid}
        style={{ color: t.color }}
      >
        {value}
      </div>
    </div>
  );
}
