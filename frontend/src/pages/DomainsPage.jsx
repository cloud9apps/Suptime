import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader, StatusDot } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { domain: "", track_ssl: true, track_whois: true, notes: "" };

function statusForDays(days, warnAt) {
  if (days == null) return "unknown";
  if (days < 0) return "down";
  if (days <= warnAt) return "warning";
  return "up";
}

export default function DomainsPage() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/domains");
    setItems(data);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      await api.post("/domains", form);
      toast.success("Domain added — first check queued");
      setOpen(false);
      setForm(EMPTY);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this tracked domain?")) return;
    await api.delete(`/domains/${id}`);
    load();
  };

  const recheck = async (id) => {
    toast.info("Rechecking...");
    try {
      await api.post(`/domains/${id}/check`);
      toast.success("Refreshed");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="DOMAINS & SSL / 02"
        title="Certificate & Registrar Watch"
        description="Track SSL expiry via TLS handshake and domain expiry via WHOIS. Warn thresholds are configurable in Alerts."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid="add-domain-btn"
                className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-10"
              >
                <Plus className="w-4 h-4 mr-2" /> Add Domain
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0a0a0a] border border-white/10 rounded-none max-w-lg">
              <DialogHeader><DialogTitle className="font-display">Track a domain</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Domain</Label>
                  <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}
                    placeholder="example.com" data-testid="domain-input"
                    className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Track SSL certificate</Label>
                  <Switch checked={form.track_ssl} onCheckedChange={(v) => setForm({ ...form, track_ssl: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Track domain (WHOIS)</Label>
                  <Switch checked={form.track_whois} onCheckedChange={(v) => setForm({ ...form, track_whois: v })} />
                </div>
                <div>
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={add} disabled={busy || !form.domain} data-testid="save-domain-btn"
                  className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs">
                  {busy ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="p-6 md:p-10">
        <div className="border border-white/10">
          <div className="grid grid-cols-12 px-4 py-3 border-b border-white/10 font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/40">
            <div className="col-span-3">Domain</div>
            <div className="col-span-3">SSL expires</div>
            <div className="col-span-3">Domain expires</div>
            <div className="col-span-2">Last checked</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          {items.length === 0 && (
            <div className="p-10 text-sm text-white/40 font-mono-s">
              <span className="blink">▍</span> No domains tracked yet.
            </div>
          )}
          {items.map((d) => {
            const ssl = d.ssl || {};
            const who = d.whois || {};
            const sslStatus = d.track_ssl ? statusForDays(ssl.days_remaining, 14) : "unknown";
            const whoStatus = d.track_whois ? statusForDays(who.days_remaining, 30) : "unknown";
            return (
              <div
                key={d.id}
                data-testid={`domain-row-${d.id}`}
                className="grid grid-cols-12 px-4 py-3 border-b border-white/[0.06] hover:bg-white/[0.02] items-center"
              >
                <div className="col-span-3 font-medium truncate">{d.domain}</div>
                <div className="col-span-3 flex items-center gap-2 font-mono-s text-xs">
                  <StatusDot status={sslStatus} />
                  {ssl.days_remaining != null ? `${ssl.days_remaining}d` : (d.track_ssl ? (ssl.error ? "err" : "…") : "—")}
                  <span className="text-white/40 truncate">{ssl.valid_until || ""}</span>
                </div>
                <div className="col-span-3 flex items-center gap-2 font-mono-s text-xs">
                  <StatusDot status={whoStatus} />
                  {who.days_remaining != null ? `${who.days_remaining}d` : (d.track_whois ? (who.error ? "err" : "…") : "—")}
                  <span className="text-white/40 truncate">
                    {who.expires_at_iso ? who.expires_at_iso.slice(0, 10) : ""}
                  </span>
                </div>
                <div className="col-span-2 font-mono-s text-[11px] text-white/40 truncate">
                  {d.last_checked_at ? new Date(d.last_checked_at).toLocaleString() : "queued"}
                </div>
                <div className="col-span-1 flex justify-end gap-1">
                  <button
                    onClick={() => recheck(d.id)}
                    data-testid={`recheck-domain-${d.id}`}
                    className="p-1.5 border border-white/10 hover:border-white/40 hover:text-[#00FF66] transition-colors"
                    title="Recheck"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => del(d.id)}
                    className="p-1.5 border border-white/10 hover:border-[#FF3366]/50 hover:text-[#FF3366] transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
