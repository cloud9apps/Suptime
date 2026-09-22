import { useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Send, Save, Plus, Trash2, Download, Upload, Mail, Zap, Settings2,
  Gauge, Globe, Archive,
} from "lucide-react";

const uid = () => Math.random().toString(36).slice(2, 10);
const INPUT = "mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0";
const LABEL = "font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60";
const OUTLINE_BTN = "rounded-none border border-white/20 bg-transparent text-white hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-[10px] h-9";

const TABS = [
  { v: "general", label: "General", icon: Settings2 },
  { v: "email", label: "Email & SMTP", icon: Mail },
  { v: "webhooks", label: "Webhooks", icon: Zap },
  { v: "thresholds", label: "Thresholds", icon: Gauge },
  { v: "public", label: "Public Page", icon: Globe },
  { v: "backup", label: "Backup & Digest", icon: Archive },
];

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tab, setTab] = useState("general");

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

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings/notifications", s);
      toast.success("Settings saved");
      window.dispatchEvent(new Event("sentinel:branding"));
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

  return (
    <div>
      <PageHeader
        eyebrow="SETTINGS / 06"
        title="Settings"
        description="Branding, alert channels, thresholds, public page and backups."
        actions={
          <>
            <Button onClick={test} disabled={testing} variant="outline" data-testid="test-alerts-btn"
              className="rounded-none border-white/20 bg-transparent text-white hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-xs h-10">
              <Send className="w-4 h-4 mr-2" /> {testing ? "Sending..." : "Test alert"}
            </Button>
            <Button onClick={save} disabled={busy} data-testid="save-settings-btn"
              className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-10">
              <Save className="w-4 h-4 mr-2" /> {busy ? "Saving..." : "Save"}
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="p-6 md:p-10 max-w-5xl">
        <TabsList data-testid="settings-tabs"
          className="h-auto w-full justify-start flex-wrap gap-1 rounded-none bg-transparent p-0 border-b border-white/10 mb-6">
          {TABS.map((t) => (
            <TabsTrigger key={t.v} value={t.v} data-testid={`tab-${t.v}`}
              className="rounded-none px-4 py-2.5 font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/50 border-b-2 border-transparent -mb-px data-[state=active]:border-[#00FF66] data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <t.icon className="w-3.5 h-3.5 mr-2" /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general"><GeneralTab s={s} set={set} /></TabsContent>
        <TabsContent value="email"><EmailTab s={s} set={set} /></TabsContent>
        <TabsContent value="webhooks"><WebhooksTab s={s} set={set} /></TabsContent>
        <TabsContent value="thresholds"><ThresholdsTab s={s} set={set} /></TabsContent>
        <TabsContent value="public"><PublicTab s={s} set={set} /></TabsContent>
        <TabsContent value="backup"><BackupTab s={s} reload={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Section({ eyebrow, title, right, children }) {
  return (
    <section className="border border-white/10">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">{eyebrow}</div>
          <div className="font-display text-lg mt-1">{title}</div>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function GeneralTab({ s, set }) {
  return (
    <div className="space-y-6">
      <Section eyebrow="Branding" title="Application name">
        <Label className={LABEL}>App name</Label>
        <Input value={s.app_name || ""} onChange={(e) => set({ app_name: e.target.value })}
          placeholder="Sentinel" data-testid="app-name" className={INPUT} maxLength={40} />
        <div className="text-[11px] text-white/40 mt-2">
          Shown in the sidebar, browser title and login page. Email subjects keep the <code className="font-mono-s">[Sentinel]</code> prefix.
        </div>
      </Section>
      <Section eyebrow="Self-hosting" title="Deployment guide">
        <div className="text-xs text-white/60">
          The repository ships with <code className="font-mono-s text-white/80">SELF_HOSTING.md</code> and a
          <code className="font-mono-s text-white/80"> deploy/</code> folder (Docker Compose, Dockerfiles, nginx config).
          Environment keys: <code className="font-mono-s text-white/80">MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, CORS_ORIGINS</code>.
        </div>
      </Section>
    </div>
  );
}

function EmailTab({ s, set }) {
  const setSmtp = (patch) => set({ smtp: { ...s.smtp, ...patch } });
  return (
    <div className="space-y-6">
      <Section eyebrow="Channel" title="Email alerts"
        right={<Switch checked={s.email_enabled} onCheckedChange={(v) => set({ email_enabled: v })} data-testid="email-toggle" />}>
        <Label className={LABEL}>Recipient</Label>
        <Input type="email" value={s.email_recipient || ""}
          onChange={(e) => set({ email_recipient: e.target.value })}
          placeholder="you@example.com" data-testid="email-recipient" className={INPUT} />
        <div className="text-[11px] text-white/40 mt-2">
          Default delivery uses the platform-managed Resend proxy. Enable SMTP below to use your own server.
        </div>
      </Section>
      <Section eyebrow="Custom SMTP" title="Use your own mail server"
        right={<Switch checked={!!s.smtp?.enabled} onCheckedChange={(v) => setSmtp({ enabled: v })} data-testid="smtp-toggle" />}>
        {!s.smtp?.enabled ? (
          <div className="text-xs text-white/40 font-mono-s">SMTP disabled — managed Resend delivery in use.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className={LABEL}>SMTP host</Label>
              <Input value={s.smtp.host || ""} onChange={(e) => setSmtp({ host: e.target.value })}
                placeholder="smtp.gmail.com" data-testid="smtp-host" className={INPUT} />
            </div>
            <div>
              <Label className={LABEL}>Port</Label>
              <Input type="number" value={s.smtp.port || 587}
                onChange={(e) => setSmtp({ port: parseInt(e.target.value || "587") })}
                data-testid="smtp-port" className={INPUT} />
            </div>
            <div>
              <div className="flex items-center justify-between h-full">
                <Label className={LABEL}>Use STARTTLS</Label>
                <Switch checked={!!s.smtp.use_tls} onCheckedChange={(v) => setSmtp({ use_tls: v })} />
              </div>
              <div className="text-[10px] text-white/40 mt-1">Port 465 auto-uses SSL.</div>
            </div>
            <div>
              <Label className={LABEL}>Username</Label>
              <Input value={s.smtp.username || ""} onChange={(e) => setSmtp({ username: e.target.value })}
                data-testid="smtp-username" className={INPUT} />
            </div>
            <div>
              <Label className={LABEL}>Password / app key</Label>
              <Input type="password" value={s.smtp.password || ""}
                onChange={(e) => setSmtp({ password: e.target.value })}
                data-testid="smtp-password" className={INPUT} />
            </div>
            <div className="col-span-2">
              <Label className={LABEL}>From email</Label>
              <Input value={s.smtp.from_email || ""} onChange={(e) => setSmtp({ from_email: e.target.value })}
                placeholder="alerts@yourdomain.com" data-testid="smtp-from" className={INPUT} />
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function WebhooksTab({ s, set }) {
  const webhooks = s.webhooks || [];
  const add = () => set({ webhooks: [...webhooks, { id: uid(), name: "", url: "", enabled: true, format: "json" }] });
  const update = (i, patch) => {
    const copy = [...webhooks]; copy[i] = { ...copy[i], ...patch }; set({ webhooks: copy });
  };
  const remove = (i) => { const copy = [...webhooks]; copy.splice(i, 1); set({ webhooks: copy }); };
  return (
    <Section eyebrow="Channel" title="Webhooks"
      right={
        <Button onClick={add} data-testid="add-webhook-btn" className={`${OUTLINE_BTN} px-3`}>
          <Plus className="w-3 h-3 mr-1.5" /> Add webhook
        </Button>
      }>
      <div className="space-y-3">
        {webhooks.length === 0 && (
          <div className="text-xs text-white/40 font-mono-s">No webhooks configured.</div>
        )}
        {webhooks.map((wh, i) => (
          <div key={wh.id || i} data-testid={`webhook-row-${i}`}
            className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_minmax(0,130px)_auto_auto] gap-2 items-center border border-white/[0.06] p-2">
            <Input value={wh.name || ""} onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Slack / Discord / n8n" data-testid={`webhook-name-${i}`}
              className="rounded-none bg-[#050505] border-white/10 font-mono-s text-xs h-9 focus-visible:border-white/40 focus-visible:ring-0" />
            <Input value={wh.url || ""} onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://hooks.example.com/xyz" data-testid={`webhook-url-${i}`}
              className="rounded-none bg-[#050505] border-white/10 font-mono-s text-xs h-9 focus-visible:border-white/40 focus-visible:ring-0" />
            <Select value={wh.format || "json"} onValueChange={(v) => update(i, { format: v })}>
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
            <Switch checked={wh.enabled} onCheckedChange={(v) => update(i, { enabled: v })} />
            <button onClick={() => remove(i)}
              className="p-2 border border-white/10 hover:border-[#FF3366]/50 hover:text-[#FF3366] transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="text-[11px] text-white/40">
          <strong className="text-white/60">Raw JSON</strong> POSTs <code className="font-mono-s">{`{kind, subject, ...}`}</code>.
          Pick <strong className="text-white/60">Slack</strong> or <strong className="text-white/60">Discord</strong> to render
          alerts as colour-coded blocks / embeds. All enabled webhooks fire in parallel.
        </div>
      </div>
    </Section>
  );
}

function ThresholdsTab({ s, set }) {
  return (
    <Section eyebrow="Global defaults" title="Alert thresholds">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <ThresholdField label="SSL warn (days)" v={s.ssl_warn_days} onChange={(v) => set({ ssl_warn_days: v })} testid="ssl-warn-days" />
        <ThresholdField label="Domain warn (days)" v={s.domain_warn_days} onChange={(v) => set({ domain_warn_days: v })} testid="domain-warn-days" />
        <ThresholdField label="Latency warn (ms)" v={s.latency_warn_ms} onChange={(v) => set({ latency_warn_ms: v })} testid="latency-warn-ms" />
        <ThresholdField label="CPU warn (%)" v={s.cpu_warn_pct} onChange={(v) => set({ cpu_warn_pct: v })} testid="cpu-warn-pct" />
        <ThresholdField label="Memory warn (%)" v={s.mem_warn_pct} onChange={(v) => set({ mem_warn_pct: v })} testid="mem-warn-pct" />
        <ThresholdField label="Disk warn (%)" v={s.disk_warn_pct} onChange={(v) => set({ disk_warn_pct: v })} testid="disk-warn-pct" />
      </div>
      <div className="text-[11px] text-white/40 mt-4">
        Individual servers can override CPU / MEM / DISK / latency or mute alerts entirely from the Servers page.
      </div>
    </Section>
  );
}

function PublicTab({ s, set }) {
  const slug = s.public_page_slug || "";
  const publicUrl = slug ? `${window.location.origin}/status/${slug}` : "";
  return (
    <Section eyebrow="Public page" title="Shareable status page"
      right={<Switch checked={!!s.public_page_enabled} onCheckedChange={(v) => set({ public_page_enabled: v })} data-testid="public-toggle" />}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={LABEL}>Page title</Label>
          <Input value={s.public_page_title || ""} onChange={(e) => set({ public_page_title: e.target.value })}
            data-testid="public-title" className={INPUT} />
        </div>
        <div>
          <Label className={LABEL}>URL slug</Label>
          <Input value={s.public_page_slug || ""}
            onChange={(e) => set({ public_page_slug: e.target.value.toLowerCase() })}
            placeholder="acme" data-testid="public-slug" className={INPUT} />
        </div>
        {publicUrl && s.public_page_enabled && (
          <div className="col-span-2 border border-white/[0.06] px-3 py-2 flex items-center justify-between">
            <span className="font-mono-s text-xs text-[#00FF66] truncate">{publicUrl}</span>
            <button onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Copied"); }}
              className="text-[10px] font-mono-s uppercase tracking-wider text-white/60 hover:text-white">Copy</button>
          </div>
        )}
        <div className="col-span-2 text-[11px] text-white/40">
          Toggle <em>Public</em> on individual servers &amp; domains to show them on this page. Incident updates posted from the dashboard appear under each event.
        </div>
      </div>
    </Section>
  );
}

function BackupTab({ s, reload }) {
  const [sendingDigest, setSendingDigest] = useState(false);
  const fileRef = useRef(null);

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
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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
      const data = JSON.parse(await file.text());
      const { data: res } = await api.post("/backup/import", { ...data, replace });
      toast.success(`Imported: ${res.counts.servers} servers, ${res.counts.domains} domains, ${res.counts.credentials} creds, ${res.counts.notes} notes`);
      reload();
    } catch (err) {
      toast.error("Import failed: " + (err.message || "bad file"));
    } finally { e.target.value = ""; }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Section eyebrow="Weekly digest" title="Fleet summary email">
        <div className="text-xs text-white/60 mb-3">
          7-day summary: uptime per server, incidents, and upcoming expirations. Requires email alerts enabled.
        </div>
        <Button onClick={sendDigest} disabled={sendingDigest || !s.email_enabled} data-testid="send-digest-btn"
          className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-9">
          {sendingDigest ? "Sending..." : "Send digest now →"}
        </Button>
      </Section>
      <Section eyebrow="Backup / Restore" title="JSON export & import">
        <div className="text-xs text-white/60 mb-3">
          Export all servers, domains, credentials, notes and settings as JSON.
        </div>
        <div className="flex gap-2">
          <Button onClick={exportBackup} data-testid="export-btn" className={OUTLINE_BTN}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
          <Button onClick={() => fileRef.current?.click()} data-testid="import-btn" className={OUTLINE_BTN}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Import
          </Button>
          <input ref={fileRef} type="file" accept="application/json" onChange={importBackup} className="hidden" />
        </div>
      </Section>
    </div>
  );
}

function ThresholdField({ label, v, onChange, testid }) {
  return (
    <div>
      <Label className={LABEL}>{label}</Label>
      <Input type="number" min={1} value={v ?? ""}
        onChange={(e) => onChange(parseInt(e.target.value || "0"))}
        data-testid={testid} className={INPUT} />
    </div>
  );
}
