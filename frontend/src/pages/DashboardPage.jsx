import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Metric, StatusDot } from "@/components/Chrome";
import { Activity, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);

  const load = async () => {
    try {
      const [s, a] = await Promise.all([
        api.get("/dashboard"),
        api.get("/activity?limit=20"),
      ]);
      setStats(s.data);
      setActivity(a.data);
    } catch (_e) {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const s = stats?.servers || { total: 0, up: 0, down: 0, unknown: 0 };
  const d = stats?.domains || { total: 0, ssl_warn: 0, ssl_expired: 0, domain_warn: 0, domain_expired: 0 };

  return (
    <div>
      <PageHeader
        eyebrow="OVERVIEW / 00"
        title="Operations Command"
        description="Live status of every monitored server, certificate and domain."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 border-b border-white/[0.06]" data-testid="dashboard-metrics">
        <Metric label="Servers UP"   value={s.up}   tone="up"   testid="metric-up" />
        <Metric label="Servers DOWN" value={s.down} tone="down" testid="metric-down" />
        <Metric label="SSL Warn"     value={d.ssl_warn + d.ssl_expired}    tone="warn" testid="metric-ssl-warn" />
        <Metric label="Domain Warn"  value={d.domain_warn + d.domain_expired} tone="warn" testid="metric-domain-warn" />
      </div>

      <div className="px-6 md:px-10 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">
              Activity Feed
            </div>
            <Link
              to="/servers"
              className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60 hover:text-[#00FF66] inline-flex items-center gap-1"
            >
              All servers <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="max-h-[520px] overflow-auto">
            {activity.length === 0 ? (
              <div className="p-10 text-center text-sm text-white/40 font-mono-s">
                <span className="blink">▍</span> waiting for events...
              </div>
            ) : (
              activity.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-4 px-4 py-3 border-b border-white/[0.06] hover:bg-white/[0.02]"
                >
                  <StatusDot
                    status={
                      a.level === "success"
                        ? "up"
                        : a.level === "error"
                        ? "down"
                        : "warning"
                    }
                  />
                  <div className="font-mono-s text-[10px] text-white/40 w-40 shrink-0">
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm text-white/80 truncate">{a.message}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">
            Fleet Snapshot
          </div>
          <div className="p-4 space-y-4">
            <FleetRow label="Total servers" value={s.total} />
            <FleetRow label="Unknown state" value={s.unknown} tone="warn" />
            <FleetRow label="Total domains" value={d.total} />
            <FleetRow label="SSL expired" value={d.ssl_expired} tone="down" />
            <FleetRow label="Domains expired" value={d.domain_expired} tone="down" />
          </div>
          <div className="p-4 border-t border-white/10 font-mono-s text-[10px] tracking-[0.2em] uppercase text-white/40 flex items-center gap-2">
            <Activity className="w-3 h-3 text-[#00FF66]" />
            <span className="text-[#00FF66]">LIVE</span>
            <span className="blink text-[#00FF66]">▍</span>
            <span className="ml-auto">refreshes every 15s</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function FleetRow({ label, value, tone }) {
  const c =
    tone === "warn" ? "text-[#FFCC00]" : tone === "down" ? "text-[#FF3366]" : "text-white";
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
      <span className="text-xs text-white/50 uppercase tracking-wider">{label}</span>
      <span className={`font-mono-s text-lg ${c}`}>{value}</span>
    </div>
  );
}
