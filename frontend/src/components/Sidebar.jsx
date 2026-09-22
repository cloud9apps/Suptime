import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  Activity,
  Server,
  Globe,
  KeyRound,
  StickyNote,
  Bell,
  Terminal,
  LogOut,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Overview",     icon: Activity,  end: true, testid: "nav-overview" },
  { to: "/servers", label: "Servers", icon: Server,   testid: "nav-servers" },
  { to: "/domains", label: "Domains & SSL", icon: Globe, testid: "nav-domains" },
  { to: "/vault", label: "Vault",   icon: KeyRound, testid: "nav-vault" },
  { to: "/notes", label: "Notes",   icon: StickyNote, testid: "nav-notes" },
  { to: "/settings", label: "Alerts", icon: Bell,    testid: "nav-settings" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="hidden md:flex flex-col w-60 border-r border-white/10 bg-[#050505] sticky top-0 h-screen">
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 border border-white/20 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-[#00FF66]" strokeWidth={1.5} />
          </div>
          <div>
            <div className="font-display font-bold text-sm leading-none">SENTINEL</div>
            <div className="font-mono-s text-[9px] tracking-[0.25em] text-white/40 mt-1">
              MONITOR / v1
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            data-testid={item.testid}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 text-xs font-mono-s uppercase tracking-[0.15em] transition-colors border ${
                isActive
                  ? "border-white/20 bg-white/[0.04] text-white"
                  : "border-transparent text-white/50 hover:text-white hover:bg-white/[0.02]"
              }`
            }
          >
            <item.icon className="w-4 h-4" strokeWidth={1.5} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="px-3 py-2 border border-white/10">
          <div className="font-mono-s text-[9px] tracking-[0.2em] text-white/40 uppercase">
            Operator
          </div>
          <div className="text-xs mt-0.5 truncate" data-testid="sidebar-user-email">
            {user?.email || "—"}
          </div>
        </div>
        <button
          onClick={onLogout}
          data-testid="sidebar-logout-btn"
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono-s uppercase tracking-[0.15em] text-white/60 hover:text-[#FF3366] border border-transparent hover:border-[#FF3366]/40 transition-colors"
        >
          <LogOut className="w-4 h-4" strokeWidth={1.5} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
