import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/lib/api";

let cached = null;

export function useBranding() {
  const [appName, setAppName] = useState(cached || "Sentinel");
  useEffect(() => {
    const load = () =>
      axios.get(`${API}/branding`).then(({ data }) => {
        cached = data.app_name || "Sentinel";
        setAppName(cached);
        document.title = `${cached} — Monitor`;
      }).catch(() => {});
    load();
    window.addEventListener("sentinel:branding", load);
    return () => window.removeEventListener("sentinel:branding", load);
  }, []);
  return appName;
}
