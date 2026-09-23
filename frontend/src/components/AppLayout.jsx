import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "@/components/ui/sonner";

export default function AppLayout() {
  return (
    <div className="min-h-screen flex bg-[#0B0C10] text-white">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "rgba(21,24,34,0.92)", backdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#F3F4F6",
            borderRadius: 10,
            fontFamily: "'Manrope', sans-serif",
            fontSize: 12,
          },
        }}
      />
    </div>
  );
}
