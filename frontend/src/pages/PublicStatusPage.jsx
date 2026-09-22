import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { StatusDot } from "@/components/Chrome";
import { CommentList } from "@/components/IncidentComments";
import { Terminal } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PublicStatusPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await axios.get(`${API}/public/status/${slug}`);
      setData(data);
      setErr("");
    } catch (e) {
      setErr(e.response?.data?.detail || "Status page not available");
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [slug]);

  if (err) {
    return (
      <div className="min-h-screen bg-[#050505] text-white grid place-items-center">
        <div className="text-center">
          <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40 mb-2">Not Found</div>
          <div className="font-display text-2xl">{err}</div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-[#050505] text-white grid place-items-center font-mono-s text-xs text-white/60">
        <span className="blink">▍</span> loading...
      </div>
    );
  }

  const allUp = data.servers.every((s) => s.last_status === "up");
  const overall = data.servers.length === 0
    ? "No systems tracked"
    : allUp ? "All systems operational" : "Some systems degraded";
  const overallTone = data.servers.length === 0
    ? "text-white/60" : allUp ? "text-[#00FF66]" : "text-[#FF3366]";

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 border border-white/20 flex items-center justify-center">
            <Terminal className="w-5 h-5 text-[#00FF66]" strokeWidth={1.5} />
          </div>
          <span className="font-mono-s text-[11px] tracking-[0.3em] uppercase text-white/50">
            {data.title}
          </span>
        </div>

        <div className="border border-white/10 p-8 mb-8">
          <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40 mb-3">
            Overall
          </div>
          <div className={`font-display text-4xl md:text-5xl font-bold ${overallTone}`}>
            {overall}
          </div>
          <div className="font-mono-s text-[10px] text-white/40 mt-4">
            Last updated: {new Date(data.generated_at).toLocaleString()}
          </div>
        </div>

        <section className="mb-8">
          <h2 className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/50 mb-3">
            Services
          </h2>
          <div className="border border-white/10">
            {data.servers.length === 0 && (
              <div className="p-10 text-sm text-white/40 font-mono-s">No services listed.</div>
            )}
            {data.servers.map((s) => (
              <div key={s.id} data-testid={`public-server-${s.id}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-4 items-center px-4 py-4 border-b border-white/[0.06] last:border-b-0">
                <StatusDot status={s.last_status} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="font-mono-s text-[11px] text-white/40 uppercase tracking-wider">
                    {s.last_status || "unknown"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono-s text-sm">
                    {s.uptime_pct_7d != null ? `${s.uptime_pct_7d}%` : "—"}
                  </div>
                  <div className="font-mono-s text-[9px] uppercase tracking-wider text-white/40">7d uptime</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {data.domains.length > 0 && (
          <section className="mb-8">
            <h2 className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/50 mb-3">
              Domains &amp; SSL
            </h2>
            <div className="border border-white/10">
              {data.domains.map((d) => (
                <div key={d.id} data-testid={`public-domain-${d.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-center px-4 py-3 border-b border-white/[0.06] last:border-b-0">
                  <div className="font-medium truncate">{d.domain}</div>
                  <div className="font-mono-s text-xs">
                    <span className="text-white/40">SSL </span>
                    {(d.ssl?.days_remaining ?? null) != null ? `${d.ssl.days_remaining}d` : "—"}
                  </div>
                  <div className="font-mono-s text-xs">
                    <span className="text-white/40">DOM </span>
                    {(d.whois?.days_remaining ?? null) != null ? `${d.whois.days_remaining}d` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.activity.length > 0 && (
          <section>
            <h2 className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/50 mb-3">
              Recent events
            </h2>
            <div className="border border-white/10">
              {data.activity.map((a) => (
                <div key={a.id} data-testid={`public-event-${a.id}`}
                  className="border-b border-white/[0.06] last:border-b-0">
                  <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-4 items-center px-4 py-2.5">
                    <StatusDot status={
                      a.level === "success" ? "up"
                        : a.level === "error" ? "down" : "warning"
                    } />
                    <div className="font-mono-s text-[10px] text-white/40 w-40">
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                    <div className="text-sm text-white/80 truncate">{a.message}</div>
                  </div>
                  {a.comments?.length > 0 && (
                    <div className="px-4 pb-3 pl-[calc(1rem+0.5rem+1rem+10rem+1rem)]">
                      <CommentList comments={a.comments} testidPrefix="public-comment" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-10 text-center font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/30">
          Powered by Sentinel Monitor
        </div>
      </div>
    </div>
  );
}
