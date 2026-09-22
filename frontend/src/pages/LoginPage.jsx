import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiError } from "@/lib/api";
import { Terminal, ShieldCheck } from "lucide-react";
import { useBranding } from "@/lib/useBranding";

export default function LoginPage() {
  const { login } = useAuth();
  const appName = useBranding();
  const [email, setEmail] = useState("admin@sentinel.app");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-[#050505] text-white">
      {/* Left: brand panel */}
      <div className="hidden lg:flex relative overflow-hidden border-r border-white/10">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1644088379091-d574269d422f?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MDV8MHwxfHNlYXJjaHwxfHxjeWJlciUyMG5ldHdvcmslMjBhYnN0cmFjdHxlbnwwfHx8fDE3OTAwOTczODd8MA&ixlib=rb-4.1.0&q=85")',
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#050505] via-[#050505]/60 to-transparent" />
        <div className="relative z-10 p-14 flex flex-col justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-white/20 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-[#00FF66]" strokeWidth={1.5} />
            </div>
            <span className="font-mono-s text-xs tracking-[0.3em] uppercase text-white/60">
              {appName} / v1
            </span>
          </div>

          <div>
            <h1 className="font-display text-5xl xl:text-6xl font-bold leading-[0.95] tracking-tight">
              Every server.
              <br />
              Every cert.
              <br />
              <span className="text-[#00FF66]">One console.</span>
            </h1>
            <p className="mt-6 text-white/60 max-w-md text-sm">
              Self-hosted uptime, SSL &amp; domain expiry, credential vault, and
              webhook + email alerts — from a single terminal-grade dashboard.
            </p>
          </div>

          <div className="font-mono-s text-[11px] text-white/40 tracking-wider">
            <span className="inline-block w-2 h-2 bg-[#00FF66] mr-2 align-middle" />
            SYSTEM READY — awaiting operator
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono-s text-[11px] uppercase tracking-[0.2em] text-white/50">
              <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.5} />
              Operator Access
            </div>
            <h2 className="font-display text-3xl font-bold">Sign in</h2>
            <p className="text-sm text-white/50">
              Single-operator console. Credentials seeded from env.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60"
              >
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email-input"
                className="bg-[#050505] border-white/10 rounded-none font-mono-s text-sm h-11 focus-visible:border-white/40 focus-visible:ring-0"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="font-mono-s text-[10px] uppercase tracking-[0.2em] text-white/60"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password-input"
                className="bg-[#050505] border-white/10 rounded-none font-mono-s text-sm h-11 focus-visible:border-white/40 focus-visible:ring-0"
              />
            </div>
          </div>

          {error && (
            <div
              data-testid="login-error"
              className="border border-[#FF3366]/50 bg-[#FF3366]/5 px-3 py-2 text-xs font-mono-s text-[#FF3366]"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy}
            data-testid="login-submit-btn"
            className="w-full h-11 rounded-none bg-white text-black hover:bg-[#00FF66] hover:text-black font-mono-s tracking-[0.15em] uppercase text-xs transition-colors"
          >
            {busy ? "Authenticating..." : "Enter Console →"}
          </Button>

          <div className="text-[11px] font-mono-s text-white/30 tracking-wider">
            default admin — check <span className="text-white/60">.env</span>
          </div>
        </form>
      </div>
    </div>
  );
}
