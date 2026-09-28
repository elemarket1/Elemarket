import { Bell, BellOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { enablePush } from "@/lib/notifications/push/client-registry";

const STORAGE_KEY = "elemarket:push-enabled";

export function PushNotificationButton() {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const available = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && window.isSecureContext;
    setSupported(available);
    setEnabled(available && Notification.permission === "granted" && localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  if (!supported) return null;

  const onClick = async () => {
    setBusy(true);
    try {
      await enablePush();
      localStorage.setItem(STORAGE_KEY, "1");
      setEnabled(true);
    } catch (error) {
      console.error("[push] registration failed", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || enabled}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-market-line bg-white hover:bg-market-soft disabled:cursor-default disabled:opacity-70"
      aria-label={enabled ? "Push notifications enabled" : "Enable push notifications"}
      title={enabled ? "Push notifications enabled" : "Enable push notifications"}
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : enabled ? <Bell size={18} /> : <BellOff size={18} />}
    </button>
  );
}
