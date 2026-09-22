import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Send, Save, Plus, Trash2, Download, Upload, Mail, Zap } from "lucide-react";

const uid = () => Math.random().toString(36).slice(2, 10);

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingDigest, setSendingDigest] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    const { data } = await api.get("/settings/notifications");
    setS(data);
  };

  useEffect(() => { load(); }, []);

  if (!s) {
    return (
      <div className="p-10 text-sm text-white/40 font-mono-s">
        <span className="blink">▍</span> loading settings...
      </div>
    );
  }

  const set = (patch) => setS({ ...s, ...patch });
  const setSmtp = (patch) => setS({ ...s, smtp: { ...s.smtp, ...patch } });

  const addWebhook = () => set({
    webhooks: [...(s.webhooks || []), { id: uid(), name: "", url: "", enabled: true }],
  });
  const updateWebhook = (i, patch) => {
    const copy = [...s.webhooks];
    copy[i] = { ...copy[i], ...patch };
    set({ webhooks: copy });
  };
  const removeWebhook = (i) => {
    const copy = [...s.webhooks];
    copy.splice(i, 1);
    set({ webhooks: copy });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings/notifications", s);
      toast.success("Settings saved");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await api.post("/settings/notifications/test");
      const whSummary = (data.webhook_results || [])
        .map((w) => `${w.name || w.url.slice(0, 20)}=${w.ok ? "OK" : "FAIL"}`)
        .join(", ") || "none";
      toast.success(`Email: ${data.email_ok ? "OK" : "skipped"} — Webhooks: ${whSummary}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setTesting(false); }
  };

  const sendDigest = async () => {
    setSendingDigest(true);
    try {
      await api.post("/settings/notifications/digest");
      toast.success("Digest sent");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSendingDigest(false); }
  };

  const exportBackup = async () => {
    try {
      const { data } = await api.get("/backup/export");
      const blob = new Blob([JSON.stringify(data, null, 2)],
        { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sentinel-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const importBackup = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const replace = window.confirm(
      "REPLACE existing data with backup?\n\nOK = replace everything.\nCancel = merge (keep existing, upsert from backup).",
    );
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { data: res } = await api.post("/backup/import", { ...data, replace });
      toast.success(
        `Imported: ${res.counts.servers} servers, ${res.counts.domains} domains, ` +
        `${res.counts.credentials} creds, ${res.counts.notes} notes`,
      );
      load();
    } catch (err) {
      toast.error("Import failed: " + (err.message || "bad file"));
    } finally {
      e.target.value = "";
    }
  };

  const slug = s.public_page_slug || "";
  const publicUrl = slug
    ? `${window.location.origin}/status/${slug}`
    : "";

  return (
    <div>
      <PageHeader
        eyebrow="ALERTS / 05"
        title="Notifications & Thresholds"
        description="Route alerts to your inbox and downstream systems. Configure thresholds, digests, public page and backups."
      />
      <div className="p-6 md:p-10 max-w-4xl space-y-6">
        {/* Email */}
        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Channel</div>
              <div className="font-display text-lg mt-1 flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#00FF66]" /> Email alerts
              </div>
            </div>
            <Switch checked={s.email_enabled}
              onCheckedChange={(v) => set({ email_enabled: v })}
              data-testid="email-toggle" />
          </div>
          <div className="p-4 space-y-3">
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Recipient</Label>
              <Input type="email" value={s.email_recipient || ""}
                onChange={(e) => set({ email_recipient: e.target.value })}
                placeholder="you@example.com" data-testid="email-recipient"
                className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            <div className="text-[11px] text-white/40">
              Default delivery uses the platform-managed Resend proxy. Enable SMTP below to use your own server.
            </div>
          </div>
        </section>

        {/* SMTP */}
        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Custom SMTP</div>
              <div className="font-display text-lg mt-1">Use your own mail server</div>
            </div>
            <Switch checked={!!s.smtp?.enabled}
              onCheckedChange={(v) => setSmtp({ enabled: v })}
              data-testid="smtp-toggle" />
          </div>
          {s.smtp?.enabled && (
            <div className="p-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SMTP host</Label>
                <Input value={s.smtp.host || ""} onChange={(e) => setSmtp({ host: e.target.value })}
                  placeholder="smtp.gmail.com" data-testid="smtp-host"
                  className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
              </div>
              <div>
                <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Port</Label>
                <Input type="number" value={s.smtp.port || 587}
                  onChange={(e) => setSmtp({ port: parseInt(e.target.value || "587") })}
                  data-testid="smtp-port"
                  className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
              </div>
              <div>
                <div className="flex items-center justify-between h-full">
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Use STARTTLS</Label>
                  <Switch checked={!!s.smtp.use_tls}
                    onCheckedChange={(v) => setSmtp({ use_tls: v })} />
                </div>
                <div className="text-[10px] text-white/40 mt-1">Port 465 auto-uses SSL.</div>
              </div>
              <div>
                <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Username</Label>
                <Input value={s.smtp.username || ""} onChange={(e) => setSmtp({ username: e.target.value })}
                  data-testid="smtp-username"
                  className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
              </div>
              <div>
                <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Password / app key</Label>
                <Input type="password" value={s.smtp.password || ""}
                  onChange={(e) => setSmtp({ password: e.target.value })}
                  data-testid="smtp-password"
                  className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
              </div>
              <div className="col-span-2">
                <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">From email</Label>
                <Input value={s.smtp.from_email || ""} onChange={(e) => setSmtp({ from_email: e.target.value })}
                  placeholder="alerts@yourdomain.com" data-testid="smtp-from"
                  className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
              </div>
            </div>
          )}
        </section>

        {/* Webhooks (many) */}
        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Channel</div>
              <div className="font-display text-lg mt-1 flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#00FF66]" /> Webhooks
              </div>
            </div>
            <Button onClick={addWebhook} data-testid="add-webhook-btn"
              className="rounded-none border border-white/20 bg-transparent text-white hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-[10px] h-9 px-3">
              <Plus className="w-3 h-3 mr-1.5" /> Add webhook
            </Button>
          </div>
          <div className="p-4 space-y-3">
            {(s.webhooks || []).length === 0 && (
              <div className="text-xs text-white/40 font-mono-s">No webhooks configured.</div>
            )}
            {(s.webhooks || []).map((wh, i) => (
              <div key={wh.id || i} data-testid={`webhook-row-${i}`}
                className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_minmax(0,120px)_auto_auto] gap-2 items-center border border-white/[0.06] p-2">
                <Input value={wh.name || ""}
                  onChange={(e) => updateWebhook(i, { name: e.target.value })}
                  placeholder="Slack / Discord / n8n" data-testid={`webhook-name-${i}`}
                  className="rounded-none bg-[#050505] border-white/10 font-mono-s text-xs h-9 focus-visible:border-white/40 focus-visible:ring-0" />
                <Input value={wh.url || ""}
                  onChange={(e) => updateWebhook(i, { url: e.target.value })}
                  placeholder="https://hooks.example.com/xyz" data-testid={`webhook-url-${i}`}
                  className="rounded-none bg-[#050505] border-white/10 font-mono-s text-xs h-9 focus-visible:border-white/40 focus-visible:ring-0" />
                <Select value={wh.format || "json"} onValueChange={(v) => updateWebhook(i, { format: v })}>
                  <SelectTrigger data-testid={`webhook-format-${i}`}
                    className="rounded-none bg-[#050505] border-white/10 font-mono-s text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-none bg-[#0a0a0a] border-white/10">
                    <SelectItem value="json">Raw JSON</SelectItem>
                    <SelectItem value="slack">Slack blocks</SelectItem>
                    <SelectItem value="discord">Discord embed</SelectItem>
                  </SelectContent>
                </Select>
                <Switch checked={wh.enabled} onCheckedChange={(v) => updateWebhook(i, { enabled: v })} />
                <button onClick={() => removeWebhook(i)}
                  className="p-2 border border-white/10 hover:border-[#FF3366]/50 hover:text-[#FF3366] transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="text-[11px] text-white/40">
              <strong className="text-white/60">Raw JSON</strong> POSTs <code className="font-mono-s">{`{kind, subject, ...}`}</code>.
              Pick <strong className="text-white/60">Slack</strong> or <strong className="text-white/60">Discord</strong> to render
              alerts as colour-coded blocks / embeds in your channel. All enabled webhooks fire in parallel.
            </div>
          </div>
        </section>

        {/* Thresholds */}
        <section className="border border-white/10 p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
          <ThresholdField label="SSL warn (days)" v={s.ssl_warn_days}
            onChange={(v) => set({ ssl_warn_days: v })} testid="ssl-warn-days" />
          <ThresholdField label="Domain warn (days)" v={s.domain_warn_days}
            onChange={(v) => set({ domain_warn_days: v })} testid="domain-warn-days" />
          <ThresholdField label="Latency warn (ms)" v={s.latency_warn_ms}
            onChange={(v) => set({ latency_warn_ms: v })} testid="latency-warn-ms" />
          <ThresholdField label="CPU warn (%)" v={s.cpu_warn_pct}
            onChange={(v) => set({ cpu_warn_pct: v })} testid="cpu-warn-pct" />
          <ThresholdField label="Memory warn (%)" v={s.mem_warn_pct}
            onChange={(v) => set({ mem_warn_pct: v })} testid="mem-warn-pct" />
          <ThresholdField label="Disk warn (%)" v={s.disk_warn_pct}
            onChange={(v) => set({ disk_warn_pct: v })} testid="disk-warn-pct" />
        </section>

        {/* Public status page */}
        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Public page</div>
              <div className="font-display text-lg mt-1">Shareable status page</div>
            </div>
            <Switch checked={!!s.public_page_enabled}
              onCheckedChange={(v) => set({ public_page_enabled: v })}
              data-testid="public-toggle" />
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Page title</Label>
              <Input value={s.public_page_title || ""}
                onChange={(e) => set({ public_page_title: e.target.value })}
                data-testid="public-title"
                className="mt-1 rounded-none bg-[#050505] border-white/10 focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            <div>
              <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">URL slug</Label>
              <Input value={s.public_page_slug || ""}
                onChange={(e) => set({ public_page_slug: e.target.value.toLowerCase() })}
                placeholder="acme"
                data-testid="public-slug"
                className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            </div>
            {publicUrl && s.public_page_enabled && (
              <div className="col-span-2 border border-white/[0.06] px-3 py-2 flex items-center justify-between">
                <span className="font-mono-s text-xs text-[#00FF66] truncate">{publicUrl}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Copied"); }}
                  className="text-[10px] font-mono-s uppercase tracking-wider text-white/60 hover:text-white"
                >Copy</button>
              </div>
            )}
            <div className="col-span-2 text-[11px] text-white/40">
              Toggle <em>Public</em> on individual servers &amp; domains to show them on this page.
            </div>
          </div>
        </section>

        {/* Digest + Backup */}
        <section className="border border-white/10 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Weekly digest</div>
            <div className="text-xs text-white/60 mt-1 mb-3">
              7-day summary: uptime per server, incidents, and upcoming expirations.
            </div>
            <Button onClick={sendDigest} disabled={sendingDigest || !s.email_enabled}
              data-testid="send-digest-btn"
              className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-9">
              {sendingDigest ? "Sending..." : "Send digest now →"}
            </Button>
          </div>
          <div>
            <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Backup / Restore</div>
            <div className="text-xs text-white/60 mt-1 mb-3">
              Export all servers, domains, credentials, notes and settings as JSON.
            </div>
            <div className="flex gap-2">
              <Button onClick={exportBackup} data-testid="export-btn"
                className="rounded-none border border-white/20 bg-transparent text-white hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-[10px] h-9">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Export
              </Button>
              <Button onClick={() => fileRef.current?.click()} data-testid="import-btn"
                className="rounded-none border border-white/20 bg-transparent text-white hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-[10px] h-9">
                <Upload className="w-3.5 h-3.5 mr-1.5" /> Import
              </Button>
              <input ref={fileRef} type="file" accept="application/json"
                onChange={importBackup} className="hidden" />
            </div>
          </div>
        </section>

        <div className="flex gap-3">
          <Button onClick={save} disabled={busy} data-testid="save-settings-btn"
            className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-10">
            <Save className="w-4 h-4 mr-2" /> {busy ? "Saving..." : "Save all settings"}
          </Button>
          <Button onClick={test} disabled={testing} variant="outline" data-testid="test-alerts-btn"
            className="rounded-none border-white/20 bg-transparent hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-xs h-10">
            <Send className="w-4 h-4 mr-2" /> {testing ? "Sending..." : "Send test alert"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ThresholdField({ label, v, onChange, testid }) {
  return (
    <div>
      <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">{label}</Label>
      <Input type="number" min={1} value={v ?? ""}
        onChange={(e) => onChange(parseInt(e.target.value || "0"))}
        data-testid={testid}
        className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
    </div>
  );
}
