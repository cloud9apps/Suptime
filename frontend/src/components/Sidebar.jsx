import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useBranding } from "@/lib/useBranding";
import {
  Activity,
  Server,
  Globe,
  KeyRound,
  StickyNote,
  Settings,
  Radar,
  SquareTerminal,
  LogOut,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Overview", icon: Activity, end: true, testid: "nav-overview", color: "#00E5FF" },
  { to: "/servers", label: "Servers", icon: Server, testid: "nav-servers", color: "#00E676" },
  { to: "/domains", label: "Domains & SSL", icon: Globe, testid: "nav-domains", color: "#FFC400" },
  { to: "/vault", label: "Vault", icon: KeyRound, testid: "nav-vault", color: "#B388FF" },
  { to: "/notes", label: "Notes", icon: StickyNote, testid: "nav-notes", color: "#FF6B9D" },
  { to: "/terminal", label: "Terminal", icon: SquareTerminal, testid: "nav-terminal", color: "#84CC16" },
  { to: "/settings", label: "Settings", icon: Settings, testid: "nav-settings", color: "#94A3B8" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const appName = useBranding();

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-white/10 bg-[#0B0C10]/80 backdrop-blur-xl sticky top-0 h-screen">
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#B388FF] to-[#00E5FF] shadow-[0_0_20px_rgba(179,136,255,0.35)]">
            <Radar className="w-4.5 h-4.5 text-[#0B0C10]" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-[15px] leading-none tracking-tight truncate max-w-[150px]" data-testid="sidebar-app-name">{appName}</div>
            <div className="font-mono-s text-[9px] tracking-[0.25em] text-slate-500 mt-1.5 uppercase">
              monitor / v1
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={item.testid}
            style={({ isActive }) => (isActive ? { "--nav": item.color } : { "--nav": item.color })}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium rounded-lg transition-colors duration-150 ${
                isActive
                  ? "bg-white/[0.06] text-white"
                  : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`}
                  style={{ background: item.color, boxShadow: `0 0 10px ${item.color}` }}
                />
                <span
                  className="w-7 h-7 rounded-md grid place-items-center transition-colors"
                  style={{
                    background: isActive ? `${item.color}22` : "transparent",
                    color: isActive ? item.color : undefined,
                  }}
                >
                  <item.icon className="w-4 h-4" strokeWidth={1.75} />
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#00E5FF] to-[#B388FF] grid place-items-center font-display font-bold text-[11px] text-[#0B0C10] shrink-0">
            {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-mono-s text-[9px] tracking-[0.2em] text-slate-500 uppercase">Operator</div>
            <div className="text-xs truncate" data-testid="sidebar-user-email">{user?.email || "—"}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          data-testid="sidebar-logout-btn"
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg text-slate-400 hover:text-[#FF1744] hover:bg-[#FF1744]/10 transition-colors"
        >
          <LogOut className="w-4 h-4" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
