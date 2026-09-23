import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, API } from "@/lib/api";
import { PageHeader, StatusDot } from "@/components/Chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Server, KeyRound, Plug, Unplug, Zap } from "lucide-react";
import { toast } from "sonner";

const INPUT = "mt-1 rounded-sm bg-[#0B0C10] border-white/10 font-mono-s text-xs h-9 focus-visible:border-[#00E5FF] focus-visible:ring-1 focus-visible:ring-[#00E5FF]/40";
const LABEL = "font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60";
const ADHOC = { host: "", port: 22, username: "root", password: "", private_key: "" };

function wsUrl() {
  const u = new URL(API.replace(/^http/, "ws") + "/ws/ssh");
  const token = localStorage.getItem("sentinel_token");
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

export default function TerminalPage() {
  const [targets, setTargets] = useState([]);
  const [adhoc, setAdhoc] = useState(ADHOC);
  const [showAdhoc, setShowAdhoc] = useState(false);
  const [status, setStatus] = useState("idle");
  const [active, setActive] = useState(null);
  const termRef = useRef(null);
  const containerRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    api.get("/terminal/targets").then(({ data }) => setTargets(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true, fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
      theme: { background: "#0B0C10", foreground: "#F8FAFC", cursor: "#00E5FF", cursorAccent: "#0B0C10",
        selectionBackground: "rgba(0,229,255,0.3)", black: "#0B0C10", red: "#FF1744", green: "#00E676", yellow: "#FFC400",
        blue: "#3B82F6", magenta: "#B388FF", cyan: "#00E5FF", white: "#F8FAFC", brightBlack: "#475569", brightRed: "#FF4D6D",
        brightGreen: "#33FFA8", brightYellow: "#FFD54F", brightBlue: "#60A5FA", brightMagenta: "#CBA4FF", brightCyan: "#33EFFF", brightWhite: "#FFFFFF" },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln("\x1b[90m▍ Sentinel web terminal — pick a target on the left or use Quick connect.\x1b[0m");
    termRef.current = term;
    fitRef.current = fit;
    term.onData((d) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "input", data: d }));
    });
    const onResize = () => {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      term.dispose();
    };
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
  }, []);

  const connect = (payload, label) => {
    disconnect();
    const term = termRef.current;
    term.clear();
    term.writeln(`\x1b[90m▍ connecting to ${label}...\x1b[0m`);
    setStatus("connecting");
    setActive(label);
    const ws = new WebSocket(wsUrl());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onopen = () => {
      fitRef.current.fit();
      ws.send(JSON.stringify({ ...payload, cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) { term.write(new Uint8Array(ev.data)); return; }
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "ready") { setStatus("connected"); term.focus(); }
        else if (m.type === "error") { term.writeln(`\r\n\x1b[31m✖ ${m.message}\x1b[0m`); toast.error(m.message); setStatus("error"); }
        else if (m.type === "closed") { term.writeln("\r\n\x1b[90m▍ session closed\x1b[0m"); setStatus("idle"); }
      } catch { term.write(ev.data); }
    };
    ws.onclose = (ev) => {
      if (ev.code === 4401) { term.writeln("\r\n\x1b[31m✖ not authenticated\x1b[0m"); }
      setStatus((s) => (s === "error" ? s : "idle"));
    };
    ws.onerror = () => setStatus("error");
  };

  const connectTarget = (t) => connect({ source: t.source, id: t.id }, `${t.username || "?"}@${t.host}:${t.port}`);
  const connectAdhoc = () => {
    if (!adhoc.host || !adhoc.username) return toast.error("Host and username required");
    connect({ source: "adhoc", ...adhoc, port: parseInt(adhoc.port || 22) }, `${adhoc.username}@${adhoc.host}:${adhoc.port}`);
  };

  const servers = targets.filter((t) => t.source === "server");
  const vault = targets.filter((t) => t.source === "vault");

  return (
    <div className="flex flex-col h-screen">
      <PageHeader eyebrow="TERMINAL / 05" title="Web SSH"
        description="Open an interactive shell to any monitored server or saved SSH credential — straight from the browser."
        actions={
          <div className="flex items-center gap-3">
            <div className="font-mono-s text-[10px] uppercase tracking-[0.2em] flex items-center gap-2" data-testid="terminal-status">
              <StatusDot status={status === "connected" ? "up" : status === "connecting" ? "warning" : status === "error" ? "down" : undefined} />
              {status}{active && status !== "idle" ? ` · ${active}` : ""}
            </div>
            <Button onClick={disconnect} disabled={status === "idle"} variant="outline" data-testid="disconnect-btn"
              className="rounded-sm border-white/20 bg-transparent text-white hover:bg-white/5 font-mono-s uppercase tracking-[0.15em] text-[10px] h-9">
              <Unplug className="w-3.5 h-3.5 mr-2" /> Disconnect
            </Button>
          </div>
        } />
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] flex-1 min-h-0">
        <aside className="border-r border-white/10 overflow-auto" data-testid="terminal-targets">
          <Group icon={Server} label={`Servers (${servers.length})`}>
            {servers.length === 0 && <Empty>No servers with SSH enabled.</Empty>}
            {servers.map((t) => <TargetRow key={t.id} t={t} onClick={() => connectTarget(t)} />)}
          </Group>
          <Group icon={KeyRound} label={`Vault SSH keys (${vault.length})`}>
            {vault.length === 0 && <Empty>No “SSH Key” entries in the Vault.</Empty>}
            {vault.map((t) => <TargetRow key={t.id} t={t} onClick={() => connectTarget(t)} />)}
          </Group>
          <Group icon={Zap} label="Quick connect" right={
            <button onClick={() => setShowAdhoc(!showAdhoc)} data-testid="quick-connect-toggle"
              className="font-mono-s text-[10px] uppercase tracking-wider text-white/50 hover:text-white">{showAdhoc ? "hide" : "show"}</button>
          }>
            {showAdhoc && (
              <div className="p-3 space-y-2">
                <div className="grid grid-cols-[1fr_70px] gap-2">
                  <div><Label className={LABEL}>Host</Label>
                    <Input value={adhoc.host} onChange={(e) => setAdhoc({ ...adhoc, host: e.target.value })} data-testid="adhoc-host" className={INPUT} placeholder="10.0.0.5" /></div>
                  <div><Label className={LABEL}>Port</Label>
                    <Input type="number" value={adhoc.port} onChange={(e) => setAdhoc({ ...adhoc, port: e.target.value })} data-testid="adhoc-port" className={INPUT} /></div>
                </div>
                <div><Label className={LABEL}>Username</Label>
                  <Input value={adhoc.username} onChange={(e) => setAdhoc({ ...adhoc, username: e.target.value })} data-testid="adhoc-username" className={INPUT} /></div>
                <div><Label className={LABEL}>Password / key passphrase</Label>
                  <Input type="password" value={adhoc.password} onChange={(e) => setAdhoc({ ...adhoc, password: e.target.value })} data-testid="adhoc-password" className={INPUT} /></div>
                <div><Label className={LABEL}>Private key (optional)</Label>
                  <Textarea rows={3} value={adhoc.private_key} onChange={(e) => setAdhoc({ ...adhoc, private_key: e.target.value })} data-testid="adhoc-key"
                    className="mt-1 rounded-sm bg-[#0B0C10] border-white/10 font-mono-s text-[10px] focus-visible:border-[#00E5FF] focus-visible:ring-1 focus-visible:ring-[#00E5FF]/40" /></div>
                <Button onClick={connectAdhoc} data-testid="adhoc-connect-btn"
                  className="w-full rounded-sm bg-[#B388FF] text-[#0B0C10] hover:bg-[#9965FF] shadow-[0_0_16px_rgba(179,136,255,0.35)] font-mono-s uppercase tracking-[0.15em] text-[10px] h-9">
                  <Plug className="w-3.5 h-3.5 mr-2" /> Connect
                </Button>
                <div className="text-[10px] text-white/30">Not saved anywhere — lives only for this session.</div>
              </div>
            )}
          </Group>
        </aside>
        <div className="min-w-0 min-h-0 bg-[#0B0C10] p-3">
          <div ref={containerRef} data-testid="xterm-container" className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}

function Group({ icon: Icon, label, right, children }) {
  return (
    <div className="border-b border-white/10">
      <div className="px-4 py-3 flex items-center justify-between font-mono-s text-[10px] uppercase tracking-[0.25em] text-white/40">
        <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5" /> {label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div className="px-4 pb-3 text-xs text-white/30 font-mono-s">{children}</div>;
}

function TargetRow({ t, onClick }) {
  return (
    <button onClick={onClick} data-testid={`target-${t.source}-${t.id}`}
      className="w-full text-left px-4 py-2.5 border-t border-white/[0.06] hover:bg-white/[0.03] transition-colors flex items-center gap-3">
      {t.source === "server" ? <StatusDot status={t.last_status} /> : <KeyRound className="w-3 h-3 text-white/40" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{t.name}</div>
        <div className="font-mono-s text-[10px] text-white/40 truncate">
          {t.username || "?"}@{t.host || "no host"}:{t.port} · {t.auth}
        </div>
      </div>
      <Plug className="w-3.5 h-3.5 text-white/30" />
    </button>
  );
}
