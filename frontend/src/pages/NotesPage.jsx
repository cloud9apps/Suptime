import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

export default function NotesPage() {
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/notes");
    setNotes(data);
    if (!selectedId && data.length) {
      setSelectedId(data[0].id);
      setTitle(data[0].title);
      setContent(data[0].content);
    }
  };

  useEffect(() => { load(); }, []);

  const select = (n) => { setSelectedId(n.id); setTitle(n.title); setContent(n.content); };

  const create = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/notes", { title: "Untitled", content: "", tags: [] });
      setNotes([data, ...notes]);
      setSelectedId(data.id);
      setTitle(data.title);
      setContent(data.content);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.put(`/notes/${selectedId}`, { title, content, tags: [] });
      toast.success("Saved");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this note?")) return;
    await api.delete(`/notes/${id}`);
    if (selectedId === id) { setSelectedId(null); setTitle(""); setContent(""); }
    load();
  };

  return (
    <div>
      <PageHeader
        eyebrow="NOTES / 04"
        title="Runbooks & Notes"
        description="Ops runbooks, incident post-mortems, provider references. Plain text or markdown."
        actions={
          <Button onClick={create} data-testid="new-note-btn"
            className="rounded-sm bg-[#B388FF] text-[#0B0C10] hover:bg-[#9965FF] shadow-[0_0_16px_rgba(179,136,255,0.35)] font-mono-s uppercase tracking-[0.15em] text-xs h-10">
            <Plus className="w-4 h-4 mr-2" /> New Note
          </Button>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] min-h-[calc(100vh-180px)]">
        <div className="border-r border-white/10 max-h-[calc(100vh-180px)] overflow-auto">
          {notes.length === 0 && (
            <div className="p-6 text-sm text-white/40 font-mono-s">
              <span className="blink">▍</span> No notes yet.
            </div>
          )}
          {notes.map((n) => (
            <button key={n.id} onClick={() => select(n)} data-testid={`note-row-${n.id}`}
              className={`w-full text-left p-4 border-b border-white/[0.06] transition-colors ${
                n.id === selectedId ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
              }`}>
              <div className="text-sm font-medium truncate">{n.title || "Untitled"}</div>
              <div className="font-mono-s text-[10px] text-white/40 mt-1">
                {new Date(n.updated_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
        <div className="p-6 md:p-8">
          {selectedId ? (
            <div className="space-y-4">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="note-title"
                className="rounded-sm bg-transparent border-0 border-b border-white/10 font-display text-3xl h-auto py-2 focus-visible:ring-0 focus-visible:border-white/40 px-0" />
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} data-testid="note-content"
                rows={20}
                className="rounded-sm bg-[#0B0C10] border-white/10 font-mono-s text-sm focus-visible:border-[#00E5FF] focus-visible:ring-1 focus-visible:ring-[#00E5FF]/40" />
              <div className="flex gap-2">
                <Button onClick={save} disabled={busy} data-testid="save-note-btn"
                  className="rounded-sm bg-[#B388FF] text-[#0B0C10] hover:bg-[#9965FF] shadow-[0_0_16px_rgba(179,136,255,0.35)] font-mono-s uppercase tracking-[0.15em] text-xs h-10">
                  <Save className="w-4 h-4 mr-2" /> Save
                </Button>
                <Button onClick={() => del(selectedId)} variant="outline"
                  className="rounded-sm border-[#FF1744]/40 bg-transparent text-[#FF1744] hover:bg-[#FF1744]/10 font-mono-s uppercase tracking-[0.15em] text-xs h-10">
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-white/40 font-mono-s">Select or create a note →</div>
          )}
        </div>
      </div>
    </div>
  );
}
