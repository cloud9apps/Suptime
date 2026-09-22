import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Send, Save } from "lucide-react";

export default function SettingsPage() {
  const [s, setS] = useState({
    email_enabled: false, email_recipient: "",
    webhook_enabled: false, webhook_url: "",
    ssl_warn_days: 14, domain_warn_days: 30,
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    const { data } = await api.get("/settings/notifications");
    setS(data);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings/notifications", s);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await api.post("/settings/notifications/test");
      toast.success(`Email: ${data.email_ok ? "OK" : "skipped"} — Webhook: ${data.webhook_ok ? "OK" : "skipped"}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setTesting(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="ALERTS / 05"
        title="Notifications & Thresholds"
        description="Route alerts to your inbox and downstream systems. Configure how early we warn on expiry."
      />
      <div className="p-6 md:p-10 max-w-3xl space-y-6">
        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Channel</div>
              <div className="font-display text-lg mt-1">Email alerts</div>
            </div>
            <Switch checked={s.email_enabled} onCheckedChange={(v) => setS({ ...s, email_enabled: v })} data-testid="email-toggle" />
          </div>
          <div className="p-4">
            <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Recipient</Label>
            <Input type="email" value={s.email_recipient || ""} onChange={(e) => setS({ ...s, email_recipient: e.target.value })}
              placeholder="you@example.com" data-testid="email-recipient"
              className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            <div className="text-[11px] text-white/40 mt-2">
              Delivered via Emergent's managed Resend proxy. No SMTP setup required.
            </div>
          </div>
        </section>

        <section className="border border-white/10">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">Channel</div>
              <div className="font-display text-lg mt-1">Webhook</div>
            </div>
            <Switch checked={s.webhook_enabled} onCheckedChange={(v) => setS({ ...s, webhook_enabled: v })} data-testid="webhook-toggle" />
          </div>
          <div className="p-4">
            <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">URL</Label>
            <Input value={s.webhook_url || ""} onChange={(e) => setS({ ...s, webhook_url: e.target.value })}
              placeholder="https://hooks.example.com/xyz" data-testid="webhook-url"
              className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
            <div className="text-[11px] text-white/40 mt-2">
              POSTs JSON <code className="font-mono-s">{`{kind, subject, ...}`}</code>. Works with Slack, Discord, n8n, Zapier.
            </div>
          </div>
        </section>

        <section className="border border-white/10 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SSL warn threshold (days)</Label>
            <Input type="number" min={1} value={s.ssl_warn_days} onChange={(e) => setS({ ...s, ssl_warn_days: parseInt(e.target.value || "14") })}
              data-testid="ssl-warn-days"
              className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
          </div>
          <div>
            <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Domain warn threshold (days)</Label>
            <Input type="number" min={1} value={s.domain_warn_days} onChange={(e) => setS({ ...s, domain_warn_days: parseInt(e.target.value || "30") })}
              data-testid="domain-warn-days"
              className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
          </div>
        </section>

        <div className="flex gap-3">
          <Button onClick={save} disabled={busy} data-testid="save-settings-btn"
            className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-10">
            <Save className="w-4 h-4 mr-2" /> {busy ? "Saving..." : "Save"}
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
