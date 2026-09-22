import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, StatusDot } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, RefreshCw, Trash2, Server, Cpu, HardDrive, MemoryStick, ArrowRight, Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const EMPTY = {
  name: "",
  check_kind: "https",
  target: "",
  interval_seconds: 300,
  notes: "",
  tags: [],
  ssh_enabled: false,
  ssh_host: "",
  ssh_port: 22,
  ssh_username: "",
  ssh_password: "",
  ssh_private_key: "",
  agent_enabled: false,
  public: false,
  alerts_muted: false,
  alert_overrides: { cpu_warn_pct: null, mem_warn_pct: null, disk_warn_pct: null, latency_warn_ms: null },
};

export default function ServersPage() {
  const [servers, setServers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState({ checks: [], metrics: [] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/servers");
    setServers(data);
    if (!selectedId && data.length) setSelectedId(data[0].id);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const fetchHist = async () => {
      const { data } = await api.get(`/servers/${selectedId}/history?hours=24`);
      setHistory(data);
    };
    fetchHist();
    const t = setInterval(fetchHist, 30000);
    return () => clearInterval(t);
  }, [selectedId]);

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (s) => {
    setEditingId(s.id);
    setForm({ ...EMPTY, ...s, alert_overrides: { ...EMPTY.alert_overrides, ...(s.alert_overrides || {}) } });
    setOpen(true);
  };

  const toggleMute = async (s) => {
    try {
      await api.put(`/servers/${s.id}`, { ...EMPTY, ...s, alerts_muted: !s.alerts_muted });
      toast.success(s.alerts_muted ? "Alerts unmuted" : "Alerts muted");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/servers/${editingId}`, form);
        toast.success("Server updated");
      } else {
        await api.post("/servers", form);
        toast.success("Server added");
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this server and its history?")) return;
    await api.delete(`/servers/${id}`);
    toast.success("Deleted");
    if (selectedId === id) setSelectedId(null);
    load();
  };

  const runCheck = async (id) => {
    try {
      await api.post(`/servers/${id}/check`);
      toast.success("Check triggered");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const runSsh = async (id) => {
    try {
      const { data } = await api.post(`/servers/${id}/ssh-metrics`);
      if (data.ok) toast.success("Metrics pulled");
      else toast.error(data.error || "SSH failed");
      // refresh history
      const { data: h } = await api.get(`/servers/${id}/history?hours=24`);
      setHistory(h);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const selected = servers.find((s) => s.id === selectedId);
  const chartData = history.checks.map((c) => ({
    t: new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    latency: c.latency_ms,
  }));
  const cpuData = history.metrics
    .filter((m) => m.cpu_percent != null)
    .map((m) => ({
      t: new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      cpu: m.cpu_percent,
      mem: m.mem_percent,
    }));
  const lastMetric = [...history.metrics].reverse()[0];

  return (
    <div>
      <PageHeader
        eyebrow="SERVERS / 01"
        title="Monitored Servers"
        description="HTTP, HTTPS, TCP and ICMP probes. Optional agentless SSH or lightweight agent metrics."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={openNew}
                data-testid="add-server-btn"
                className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-10"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Server
              </Button>
            </DialogTrigger>
            <ServerFormDialog form={form} setForm={setForm} onSave={save} busy={busy} editing={editingId} />
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] min-h-[calc(100vh-180px)]">
        {/* List */}
        <div className="border-r border-white/10" data-testid="servers-list">
          {servers.length === 0 && (
            <div className="p-10 text-sm text-white/40 font-mono-s">
              <span className="blink">▍</span> No servers yet. Add your first target.
            </div>
          )}
          {servers.map((s) => {
            const isSel = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                data-testid={`server-row-${s.id}`}
                className={`w-full text-left p-4 border-b border-white/[0.06] transition-colors ${
                  isSel ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusDot status={s.last_status} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {s.name}
                        {s.alerts_muted && <BellOff className="w-3 h-3 text-[#FFCC00] shrink-0" data-testid={`muted-icon-${s.id}`} />}
                      </div>
                      <div className="font-mono-s text-[11px] text-white/40 truncate">
                        {s.check_kind}://{s.target}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono-s text-xs">
                      {s.last_latency_ms != null ? `${s.last_latency_ms}ms` : "—"}
                    </div>
                    <div className="font-mono-s text-[10px] text-white/40">
                      {s.uptime_pct_24h != null ? `${s.uptime_pct_24h}%` : "—"}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="p-6 md:p-8 min-w-0">
          {!selected ? (
            <div className="text-sm text-white/40 font-mono-s">Select a server →</div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot status={selected.last_status} />
                    <span className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/50">
                      {selected.last_status || "unknown"}
                    </span>
                  </div>
                  <h2 className="font-display text-2xl font-bold mt-1">{selected.name}</h2>
                  <div className="font-mono-s text-xs text-white/40 mt-1">
                    {selected.check_kind}://{selected.target}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => toggleMute(selected)}
                    variant="outline"
                    data-testid="mute-toggle-btn"
                    className={`rounded-none bg-transparent h-9 font-mono-s uppercase tracking-[0.15em] text-[10px] ${
                      selected.alerts_muted
                        ? "border-[#FFCC00]/50 text-[#FFCC00] hover:bg-[#FFCC00]/10"
                        : "border-white/20 hover:bg-white/5"
                    }`}
                  >
                    {selected.alerts_muted
                      ? <><BellOff className="w-3.5 h-3.5 mr-2" /> Muted</>
                      : <><Bell className="w-3.5 h-3.5 mr-2" /> Mute</>}
                  </Button>
                  <Button
                    onClick={() => runCheck(selected.id)}
                    variant="outline"
                    data-testid="run-check-btn"
                    className="rounded-none border-white/20 bg-transparent hover:bg-white/5 h-9 font-mono-s uppercase tracking-[0.15em] text-[10px]"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-2" /> Check now
                  </Button>
                  {selected.ssh_enabled && (
                    <Button
                      onClick={() => runSsh(selected.id)}
                      variant="outline"
                      data-testid="ssh-metrics-btn"
                      className="rounded-none border-white/20 bg-transparent hover:bg-white/5 h-9 font-mono-s uppercase tracking-[0.15em] text-[10px]"
                    >
                      <Cpu className="w-3.5 h-3.5 mr-2" /> Pull SSH metrics
                    </Button>
                  )}
                  <Button
                    onClick={() => openEdit(selected)}
                    variant="outline"
                    data-testid="edit-server-btn"
                    className="rounded-none border-white/20 bg-transparent hover:bg-white/5 h-9 font-mono-s uppercase tracking-[0.15em] text-[10px]"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => del(selected.id)}
                    variant="outline"
                    data-testid="delete-server-btn"
                    className="rounded-none border-[#FF3366]/40 bg-transparent text-[#FF3366] hover:bg-[#FF3366]/10 h-9 font-mono-s uppercase tracking-[0.15em] text-[10px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 border border-white/10">
                <MetricCell
                  icon={<Server className="w-4 h-4" />}
                  label="Uptime 24h"
                  value={selected.uptime_pct_24h != null ? `${selected.uptime_pct_24h}%` : "—"}
                />
                <MetricCell
                  icon={<ArrowRight className="w-4 h-4" />}
                  label="Latency"
                  value={selected.last_latency_ms != null ? `${selected.last_latency_ms}ms` : "—"}
                />
                <MetricCell
                  icon={<RefreshCw className="w-4 h-4" />}
                  label="Interval"
                  value={`${selected.interval_seconds}s`}
                />
              </div>

              <div className="border border-white/10">
                <div className="p-3 border-b border-white/10 font-mono-s text-[10px] tracking-[0.25em] uppercase text-white/40">
                  Latency (24h)
                </div>
                <div className="p-4 h-56">
                  {chartData.length === 0 ? (
                    <div className="h-full grid place-items-center text-xs text-white/40 font-mono-s">no samples yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="t" stroke="#6B7280" fontSize={10} style={{ fontFamily: "JetBrains Mono" }} />
                        <YAxis stroke="#6B7280" fontSize={10} style={{ fontFamily: "JetBrains Mono" }} />
                        <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 0, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                        <Line type="monotone" dataKey="latency" stroke="#00FF66" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {(selected.ssh_enabled || selected.agent_enabled) && (
                <>
                  <div className="grid grid-cols-3 border border-white/10">
                    <MetricCell
                      icon={<Cpu className="w-4 h-4" />}
                      label="CPU"
                      value={lastMetric?.cpu_percent != null ? `${lastMetric.cpu_percent}%` : "—"}
                    />
                    <MetricCell
                      icon={<MemoryStick className="w-4 h-4" />}
                      label="Memory"
                      value={lastMetric?.mem_percent != null ? `${lastMetric.mem_percent}%` : "—"}
                    />
                    <MetricCell
                      icon={<HardDrive className="w-4 h-4" />}
                      label="Disk"
                      value={lastMetric?.disk_percent != null ? `${lastMetric.disk_percent}%` : "—"}
                    />
                  </div>
                  <div className="border border-white/10">
                    <div className="p-3 border-b border-white/10 font-mono-s text-[10px] tracking-[0.25em] uppercase text-white/40">
                      CPU / Memory (24h)
                    </div>
                    <div className="p-4 h-56">
                      {cpuData.length === 0 ? (
                        <div className="h-full grid place-items-center text-xs text-white/40 font-mono-s">no samples yet</div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={cpuData}>
                            <CartesianGrid stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="t" stroke="#6B7280" fontSize={10} style={{ fontFamily: "JetBrains Mono" }} />
                            <YAxis stroke="#6B7280" fontSize={10} style={{ fontFamily: "JetBrains Mono" }} domain={[0, 100]} />
                            <Tooltip contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 0, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                            <Line type="monotone" dataKey="cpu" stroke="#00FF66" strokeWidth={1.5} dot={false} isAnimationActive={false} name="CPU %" />
                            <Line type="monotone" dataKey="mem" stroke="#FFCC00" strokeWidth={1.5} dot={false} isAnimationActive={false} name="MEM %" />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </>
              )}

              {selected.agent_enabled && selected.agent_token && (
                <div className="border border-white/10 p-4">
                  <div className="font-mono-s text-[10px] tracking-[0.25em] uppercase text-white/40 mb-3">
                    Lightweight Agent
                  </div>
                  <div className="text-xs text-white/70 mb-2">
                    Push metrics from any Linux box with one command:
                  </div>
                  <pre
                    data-testid="agent-command"
                    className="font-mono-s text-[11px] bg-[#050505] border border-white/10 p-3 overflow-auto whitespace-pre-wrap break-all"
                  >
{`while true; do
  CPU=$(top -bn1 | grep -E '^%?Cpu' | head -1 | awk -F',' '{for(i=1;i<=NF;i++) if($i ~ /id/){gsub(/ /,"",$i); print 100-$1}}' 2>/dev/null || echo "")
  MEM=$(free | awk '/Mem:/ {printf "%.1f", $3/$2*100}')
  DISK=$(df -P / | awk 'NR==2{print $5}' | tr -d '%')
  curl -s -X POST ${process.env.REACT_APP_BACKEND_URL}/api/agent/metrics \\
    -H 'Content-Type: application/json' \\
    -d "{\\"server_id\\":\\"${selected.id}\\",\\"agent_token\\":\\"${selected.agent_token}\\",\\"cpu_percent\\":$CPU,\\"mem_percent\\":$MEM,\\"disk_percent\\":$DISK}"
  sleep 60
done`}
                  </pre>
                </div>
              )}

              {(selected.alerts_muted || Object.values(selected.alert_overrides || {}).some((v) => v != null)) && (
                <div className="border border-[#FFCC00]/30 p-4" data-testid="alert-rules-panel">
                  <div className="font-mono-s text-[10px] tracking-[0.25em] uppercase text-[#FFCC00] mb-2">
                    Alert Rules (server-specific)
                  </div>
                  <div className="flex flex-wrap gap-2 font-mono-s text-[11px]">
                    {selected.alerts_muted && (
                      <span className="border border-[#FFCC00]/40 text-[#FFCC00] px-2 py-1">ALERTS MUTED</span>
                    )}
                    {Object.entries(selected.alert_overrides || {})
                      .filter(([, v]) => v != null)
                      .map(([k, v]) => (
                        <span key={k} className="border border-white/15 text-white/70 px-2 py-1">
                          {k.replace("_warn_pct", "").replace("_warn_ms", "").toUpperCase()} ≥ {v}{k.endsWith("ms") ? "ms" : "%"}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="border border-white/10 p-4">
                  <div className="font-mono-s text-[10px] tracking-[0.25em] uppercase text-white/40 mb-2">
                    Notes
                  </div>
                  <div className="text-sm text-white/80 whitespace-pre-wrap">{selected.notes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCell({ icon, label, value }) {
  return (
    <div className="p-5 border-r border-white/[0.06] last:border-r-0">
      <div className="flex items-center gap-2 font-mono-s text-[10px] tracking-[0.2em] uppercase text-white/40 mb-2">
        {icon}
        {label}
      </div>
      <div className="font-display text-2xl">{value}</div>
    </div>
  );
}

function ServerFormDialog({ form, setForm, onSave, busy, editing }) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <DialogContent className="bg-[#0a0a0a] border border-white/10 rounded-none max-w-2xl max-h-[90vh] overflow-auto">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">
          {editing ? "Edit Server" : "Add Server"}
        </DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Name</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="form-name"
            className="mt-1 rounded-none bg-[#050505] border-white/10 focus-visible:border-white/40 focus-visible:ring-0" />
        </div>
        <div>
          <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Check kind</Label>
          <Select value={form.check_kind} onValueChange={(v) => set("check_kind", v)}>
            <SelectTrigger data-testid="form-kind" className="mt-1 rounded-none bg-[#050505] border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none bg-[#0a0a0a] border-white/10">
              <SelectItem value="https">HTTPS</SelectItem>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="ping">Ping (ICMP)</SelectItem>
              <SelectItem value="tcp">TCP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">
            Target {form.check_kind === "tcp" && "(host:port)"}
          </Label>
          <Input value={form.target} onChange={(e) => set("target", e.target.value)} data-testid="form-target"
            className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
        </div>
        <div>
          <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Interval (sec)</Label>
          <Input type="number" min={30} value={form.interval_seconds} onChange={(e) => set("interval_seconds", parseInt(e.target.value || "60"))}
            className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
        </div>
        <div className="col-span-2">
          <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Notes</Label>
          <Textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)}
            className="mt-1 rounded-none bg-[#050505] border-white/10 focus-visible:border-white/40 focus-visible:ring-0" />
        </div>

        <div className="col-span-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <Label className="font-mono-s text-[11px] uppercase tracking-[0.2em]">Enable SSH metrics (agentless)</Label>
            <Switch checked={form.ssh_enabled} onCheckedChange={(v) => set("ssh_enabled", v)} data-testid="ssh-toggle" />
          </div>
        </div>
        {form.ssh_enabled && (
          <>
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SSH host</Label>
              <Input value={form.ssh_host || ""} onChange={(e) => set("ssh_host", e.target.value)} className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SSH port</Label>
              <Input type="number" value={form.ssh_port} onChange={(e) => set("ssh_port", parseInt(e.target.value || "22"))} className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SSH username</Label>
              <Input value={form.ssh_username || ""} onChange={(e) => set("ssh_username", e.target.value)} className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Password (or leave blank if using key)</Label>
              <Input type="password" value={form.ssh_password || ""} onChange={(e) => set("ssh_password", e.target.value)} className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            <div className="col-span-2">
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SSH private key (PEM, optional)</Label>
              <Textarea value={form.ssh_private_key || ""} onChange={(e) => set("ssh_private_key", e.target.value)} rows={4} className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s text-xs focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
          </>
        )}

        <div className="col-span-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <Label className="font-mono-s text-[11px] uppercase tracking-[0.2em]">Enable lightweight agent push</Label>
            <Switch checked={form.agent_enabled} onCheckedChange={(v) => set("agent_enabled", v)} data-testid="agent-toggle" />
          </div>
          <div className="text-[11px] text-white/40 mt-1">
            Generates a per-server token. Copy install snippet after save.
          </div>
        </div>
        <div className="col-span-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <Label className="font-mono-s text-[11px] uppercase tracking-[0.2em]">Show on public status page</Label>
            <Switch checked={form.public} onCheckedChange={(v) => set("public", v)} data-testid="public-server-toggle" />
          </div>
        </div>

        <div className="col-span-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <Label className="font-mono-s text-[11px] uppercase tracking-[0.2em]">Mute all alerts for this server</Label>
            <Switch checked={!!form.alerts_muted} onCheckedChange={(v) => set("alerts_muted", v)} data-testid="mute-server-toggle" />
          </div>
          <div className="text-[11px] text-white/40 mt-1">
            Events still appear in the activity feed; email and webhooks are suppressed.
          </div>
        </div>
        <div className="col-span-2">
          <div className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60 mb-2">
            Alert threshold overrides <span className="text-white/30">(blank = use global)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["cpu_warn_pct", "CPU %"],
              ["mem_warn_pct", "MEM %"],
              ["disk_warn_pct", "DISK %"],
              ["latency_warn_ms", "Latency ms"],
            ].map(([k, label]) => (
              <div key={k}>
                <Label className="font-mono-s text-[10px] uppercase tracking-[0.15em] text-white/40">{label}</Label>
                <Input type="number" min={1} placeholder="global"
                  value={form.alert_overrides?.[k] ?? ""}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    alert_overrides: {
                      ...f.alert_overrides,
                      [k]: e.target.value === "" ? null : parseInt(e.target.value),
                    },
                  }))}
                  data-testid={`override-${k}`}
                  className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s text-xs h-9 focus-visible:border-white/40 focus-visible:ring-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={onSave}
          disabled={busy || !form.name || !form.target}
          data-testid="save-server-btn"
          className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs"
        >
          {busy ? "Saving..." : editing ? "Update" : "Add Server"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
