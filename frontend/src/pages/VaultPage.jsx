import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Eye, EyeOff, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  "hosting_panel", "cloud_provider", "ssl_provider", "ssh_key", "database", "api_key", "other",
];

const CAT_LABEL = {
  hosting_panel: "Hosting / Control Panel",
  cloud_provider: "Cloud Provider",
  ssl_provider: "SSL Provider",
  ssh_key: "SSH Key",
  database: "Database",
  api_key: "API Key",
  other: "Other",
};

const EMPTY = {
  category: "hosting_panel", name: "", url: "", username: "", password: "",
  api_key: "", ssh_key: "", notes: "", tags: [],
};

export default function VaultPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState({});

  const load = async () => {
    const { data } = await api.get("/credentials");
    setItems(data);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditingId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c) => { setEditingId(c.id); setForm({ ...EMPTY, ...c }); setOpen(true); };

  const save = async () => {
    setBusy(true);
    try {
      if (editingId) await api.put(`/credentials/${editingId}`, form);
      else await api.post("/credentials", form);
      toast.success(editingId ? "Updated" : "Saved");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this credential?")) return;
    await api.delete(`/credentials/${id}`);
    load();
  };

  const copy = async (val, label) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      toast.success(`${label} copied`);
    } catch { toast.error("Copy failed"); }
  };

  const filtered = items
    .filter((c) => filter === "all" || c.category === filter)
    .filter((c) => !q || (c.name + (c.url || "") + (c.username || "") + (c.notes || "")).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader
        eyebrow="VAULT / 03"
        title="Credential Vault"
        description="Store hosting panel logins, SSH keys, SSL provider info, cloud accounts and API keys."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} data-testid="add-cred-btn"
                className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs h-10">
                <Plus className="w-4 h-4 mr-2" /> Add Credential
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0a0a0a] border border-white/10 rounded-none max-w-2xl max-h-[90vh] overflow-auto">
              <DialogHeader><DialogTitle className="font-display">{editingId ? "Edit" : "New"} credential</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger className="mt-1 rounded-none bg-[#050505] border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-none bg-[#0a0a0a] border-white/10">
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CAT_LABEL[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="cred-name"
                    className="mt-1 rounded-none bg-[#050505] border-white/10 focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div className="col-span-2">
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">URL</Label>
                  <Input value={form.url || ""} onChange={(e) => setForm({ ...form, url: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div>
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Username</Label>
                  <Input value={form.username || ""} onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div>
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Password</Label>
                  <Input value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div className="col-span-2">
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">API Key</Label>
                  <Input value={form.api_key || ""} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div className="col-span-2">
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">SSH Key (PEM)</Label>
                  <Textarea rows={4} value={form.ssh_key || ""} onChange={(e) => setForm({ ...form, ssh_key: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 font-mono-s text-xs focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
                <div className="col-span-2">
                  <Label className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60">Notes</Label>
                  <Textarea rows={3} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="mt-1 rounded-none bg-[#050505] border-white/10 focus-visible:border-white/40 focus-visible:ring-0" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={save} disabled={busy || !form.name} data-testid="save-cred-btn"
                  className="rounded-none bg-white text-black hover:bg-[#00FF66] font-mono-s uppercase tracking-[0.15em] text-xs">
                  {busy ? "Saving..." : editingId ? "Update" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="px-6 md:px-10 py-6 flex flex-wrap gap-3 items-center border-b border-white/10">
        <Input placeholder="Search credentials..." value={q} onChange={(e) => setQ(e.target.value)}
          data-testid="vault-search"
          className="rounded-none bg-[#050505] border-white/10 max-w-xs focus-visible:border-white/40 focus-visible:ring-0" />
        <div className="flex gap-1 flex-wrap">
          {["all", ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-3 py-1.5 text-[10px] font-mono-s uppercase tracking-[0.2em] border transition-colors ${
                filter === c ? "border-white/40 text-white bg-white/5" : "border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {c === "all" ? "All" : CAT_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 md:px-10 py-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="text-sm text-white/40 font-mono-s col-span-full">
            <span className="blink">▍</span> No entries.
          </div>
        )}
        {filtered.map((c) => (
          <div key={c.id} data-testid={`cred-card-${c.id}`} className="border border-white/10 p-4 hover:border-white/20 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div className="min-w-0">
                <div className="font-mono-s text-[10px] uppercase tracking-[0.25em] text-[#00FF66] mb-1">
                  {CAT_LABEL[c.category] || c.category}
                </div>
                <div className="font-display text-lg font-semibold truncate">{c.name}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(c)} className="p-1.5 border border-white/10 hover:border-white/40 transition-colors" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => del(c.id)} className="p-1.5 border border-white/10 hover:border-[#FF3366]/50 hover:text-[#FF3366] transition-colors" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {c.url && (
              <Row label="URL" value={c.url} onCopy={() => copy(c.url, "URL")}>
                <a href={c.url.startsWith("http") ? c.url : `https://${c.url}`} target="_blank" rel="noreferrer" className="text-[#00FF66] hover:underline truncate">
                  {c.url}
                </a>
              </Row>
            )}
            {c.username && <Row label="User" value={c.username} onCopy={() => copy(c.username, "Username")} />}
            {c.password && (
              <Row
                label="Pass"
                value={reveal[c.id + "p"] ? c.password : "•".repeat(Math.min(c.password.length, 14))}
                onCopy={() => copy(c.password, "Password")}
                onToggle={() => setReveal((r) => ({ ...r, [c.id + "p"]: !r[c.id + "p"] }))}
                revealed={reveal[c.id + "p"]}
              />
            )}
            {c.api_key && (
              <Row
                label="Key"
                value={reveal[c.id + "k"] ? c.api_key : "•".repeat(Math.min(c.api_key.length, 14))}
                onCopy={() => copy(c.api_key, "API key")}
                onToggle={() => setReveal((r) => ({ ...r, [c.id + "k"]: !r[c.id + "k"] }))}
                revealed={reveal[c.id + "k"]}
              />
            )}
            {c.ssh_key && (
              <div className="mt-2">
                <button onClick={() => copy(c.ssh_key, "SSH key")} className="text-[10px] font-mono-s uppercase tracking-wider text-white/60 hover:text-[#00FF66] flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Copy SSH key ({c.ssh_key.length} chars)
                </button>
              </div>
            )}
            {c.notes && (
              <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-white/60 whitespace-pre-wrap line-clamp-3">
                {c.notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, onCopy, onToggle, revealed, children }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="font-mono-s text-[9px] uppercase tracking-[0.2em] text-white/40 w-10 shrink-0">{label}</span>
      <div className="flex-1 min-w-0 font-mono-s text-xs truncate">
        {children || value}
      </div>
      {onToggle && (
        <button onClick={onToggle} className="p-1 text-white/50 hover:text-white transition-colors">
          {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
      <button onClick={onCopy} className="p-1 text-white/50 hover:text-[#00FF66] transition-colors">
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
