import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { MessageSquare, Send, X } from "lucide-react";

export function CommentList({ comments, onDelete, testidPrefix = "comment" }) {
  if (!comments?.length) return null;
  return (
    <div className="space-y-1.5">
      {comments.map((c) => (
        <div key={c.id} data-testid={`${testidPrefix}-${c.id}`}
          className="flex items-start gap-2 border-l-2 border-[#00E676]/40 pl-3 py-1">
          <div className="min-w-0 flex-1">
            <div className="font-mono-s text-[10px] text-white/40">
              {new Date(c.created_at).toLocaleString()}
            </div>
            <div className="text-xs text-white/80 whitespace-pre-wrap break-words">{c.text}</div>
          </div>
          {onDelete && (
            <button onClick={() => onDelete(c.id)} data-testid={`${testidPrefix}-delete-${c.id}`}
              className="text-white/30 hover:text-[#FF1744] transition-colors p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function IncidentComments({ event, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const count = event.comments?.length || 0;

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/activity/${event.id}/comments`, { text: text.trim() });
      onUpdated(data);
      setText("");
      toast.success("Update posted");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const remove = async (cid) => {
    try {
      const { data } = await api.delete(`/activity/${event.id}/comments/${cid}`);
      onUpdated(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="pl-[calc(0.5rem+1rem+10rem+1rem)] pr-4 pb-2">
      <button onClick={() => setOpen(!open)} data-testid={`comment-toggle-${event.id}`}
        className={`inline-flex items-center gap-1.5 font-mono-s text-[10px] uppercase tracking-[0.15em] transition-colors ${
          count ? "text-[#00E676]" : "text-white/40 hover:text-white/70"}`}>
        <MessageSquare className="w-3 h-3" />
        {count ? `${count} update${count > 1 ? "s" : ""}` : "Add update"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <CommentList comments={event.comments} onDelete={remove} />
          <div className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && post()}
              maxLength={500} placeholder="What happened / ETA…"
              data-testid={`comment-input-${event.id}`}
              className="flex-1 h-8 bg-[#0B0C10] border border-white/10 px-2 text-xs font-mono-s focus:border-white/40 outline-none" />
            <button onClick={post} disabled={busy || !text.trim()}
              data-testid={`comment-submit-${event.id}`}
              className="h-8 px-3 border border-white/20 hover:bg-[#00E676] hover:text-black hover:border-[#00E676] disabled:opacity-40 transition-colors">
              <Send className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
