import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ServersPage from "@/pages/ServersPage";
import DomainsPage from "@/pages/DomainsPage";
import VaultPage from "@/pages/VaultPage";
import NotesPage from "@/pages/NotesPage";
import SettingsPage from "@/pages/SettingsPage";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading || user === null)
    return (
      <div className="min-h-screen grid place-items-center bg-[#050505] text-white/60 font-mono-s text-xs">
        <span className="blink">▍</span> initializing sentinel...
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Public({ children }) {
  const { user, loading } = useAuth();
  if (loading || user === null)
    return (
      <div className="min-h-screen grid place-items-center bg-[#050505] text-white/60 font-mono-s text-xs">
        <span className="blink">▍</span> loading...
      </div>
    );
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Public><LoginPage /></Public>} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route index element={<DashboardPage />} />
            <Route path="/servers" element={<ServersPage />} />
            <Route path="/domains" element={<DomainsPage />} />
            <Route path="/vault" element={<VaultPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
