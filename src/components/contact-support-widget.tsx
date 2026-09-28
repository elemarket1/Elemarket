import { useEffect, useState } from "react";
import { Headphones, Mail, MessageCircle, Phone, X } from "lucide-react";

type SupportMode = "home" | "order";

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const SUPPORT_EMAIL = configured(import.meta.env.VITE_ELEMARKET_SUPPORT_EMAIL);
const SUPPORT_PHONE = configured(import.meta.env.VITE_ELEMARKET_SUPPORT_PHONE);
const SUPPORT_WHATSAPP_RAW = configured(import.meta.env.VITE_ELEMARKET_SUPPORT_WHATSAPP);
const SUPPORT_WHATSAPP = SUPPORT_WHATSAPP_RAW && /^(https:\/\/(?:wa\.me|api\.whatsapp\.com)\/)/i.test(SUPPORT_WHATSAPP_RAW) ? SUPPORT_WHATSAPP_RAW : null;

/**
 * Deliberately quiet support entry point. It never auto-opens, never pulses,
 * and only renders on routes that explicitly opt in.
 */
export function ContactSupportWidget({ mode = "home" }: { mode?: SupportMode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const items = [
    SUPPORT_EMAIL
      ? { label: "Email", href: `mailto:${SUPPORT_EMAIL}`, icon: Mail }
      : null,
    mode === "home" ? { label: "Chat Support", href: "/support", icon: MessageCircle } : null,
    SUPPORT_PHONE
      ? { label: "Call", href: `tel:${SUPPORT_PHONE}`, icon: Phone }
      : null,
    SUPPORT_WHATSAPP
      ? { label: "WhatsApp", href: SUPPORT_WHATSAPP, icon: MessageCircle }
      : null,
  ].filter(Boolean) as Array<{ label: string; href: string; icon: typeof Mail }>;

  return (
    <div className="fixed bottom-4 right-4 z-[60] sm:bottom-5 sm:right-5" data-support-widget>
      {open ? (
        <div
          className="w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-market-line bg-white shadow-market-lg"
          role="dialog"
          aria-label="Contact ELEMARKET"
        >
          <div className="flex items-center justify-between border-b border-market-line px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-market-soft text-market-green">
                <Headphones size={15} aria-hidden="true" />
              </span>
              <span className="text-xs font-black">Contact Us</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-7 w-7 place-items-center rounded-lg text-market-muted hover:bg-market-soft"
              aria-label="Close contact options"
            >
              <X size={15} />
            </button>
          </div>
          <div className="p-2">
            {mode === "order" ? (
              <a
                href="/support?source=order"
                onClick={() => setOpen(false)}
                className="mb-1 flex items-center gap-3 rounded-xl bg-market-green px-3 py-2.5 text-xs font-black text-white hover:bg-market-green/90"
              >
                <MessageCircle size={15} aria-hidden="true" />
                Order Support
              </a>
            ) : null}
            {items.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold text-market-ink hover:bg-market-soft"
              >
                <Icon size={15} className="text-market-green" aria-hidden="true" />
                {label}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-market-line bg-white px-3 text-[11px] font-black text-market-ink shadow-market hover:border-market-green/30 hover:bg-market-soft"
          aria-expanded={false}
          aria-label={mode === "order" ? "Open order support" : "Open contact options"}
        >
          <MessageCircle size={14} className="text-market-green" aria-hidden="true" />
          {mode === "order" ? "Order Support" : "Contact Us"}
        </button>
      )}
    </div>
  );
}
