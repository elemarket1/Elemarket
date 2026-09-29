import { useEffect, useState } from "react";
import { Headphones, MessageCircle, Send, X } from "lucide-react";
import { getSupportConversation, sendSupportMessage } from "@/lib/support.functions";

type SupportMode = "home" | "order";
type Message = { id: string; senderType: string; body: string; createdAt: string };

/** Floating customer support launcher. Chat stays in a corner panel so customers can keep browsing. */
export function ContactSupportWidget({ mode = "home", orderId = null }: { mode?: SupportMode; orderId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadConversation() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSupportConversation({ data: { orderId: orderId?.trim() || null } });
      setConversationId(result.id);
      setMessages(result.messages);
    } catch (err) {
      console.error("[support-widget] conversation load failed", err);
      setError("Please sign in to chat with ELEMARKET Support.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadConversation();
    const timer = window.setInterval(() => void loadConversation(), 5000);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, orderId]);

  async function send() {
    const text = body.trim();
    if (!text || !conversationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendSupportMessage({ data: { conversationId, body: text, idempotencyKey: crypto.randomUUID() } });
      setBody("");
      await loadConversation();
    } catch (err) {
      console.error("[support-widget] message send failed", err);
      setError("Message could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }



  return (
    <div className="fixed bottom-4 right-4 z-[80] sm:bottom-5 sm:right-5" data-support-widget>
      {open ? (
        <section className="flex h-[min(34rem,calc(100vh-6rem))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-market-line bg-white shadow-market-lg" role="dialog" aria-label="ELEMARKET Support chat">
          <header className="flex items-center justify-between border-b border-market-line bg-market-green px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15"><Headphones size={16} /></span>
              <div><p className="text-sm font-black">ELEMARKET Support</p><p className="text-[10px] text-white/75">You can keep browsing while we chat.</p></div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10" aria-label="Close support chat"><X size={16} /></button>
          </header>
          <div className="flex-1 space-y-2 overflow-y-auto bg-market-bg p-3" aria-live="polite">
            {loading && messages.length === 0 ? <p className="rounded-xl bg-white p-3 text-xs text-market-muted">Connecting to Support…</p> : null}
            {!loading && error ? (
              <div className="rounded-xl bg-white p-3 text-xs text-market-muted">
                <p>{error}</p>
                <a href="/login" className="mt-2 inline-flex font-black text-market-green">Sign in</a>
              </div>
            ) : null}
            {!error && messages.length === 0 && !loading ? <p className="rounded-xl bg-white p-3 text-xs text-market-muted">Hi! Tell us what you need help with.</p> : null}
            {messages.map((message) => (
              <div key={message.id} className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs ${message.senderType === "customer" ? "ml-auto bg-market-green text-white" : "bg-white text-market-ink shadow-sm"}`}>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-market-line bg-white p-2">
            {conversationId ? (
              <div className="flex items-end gap-2">
                <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 4000))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={2} maxLength={4000} placeholder="Write a message…" className="min-h-10 flex-1 resize-none rounded-xl border border-market-line px-3 py-2 text-xs outline-none focus:border-market-green" aria-label="Support message" />
                <button type="button" onClick={() => void send()} disabled={busy || !body.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-market-orange text-white disabled:opacity-40" aria-label="Send support message"><Send size={15} /></button>
              </div>
            ) : <p className="px-2 py-1 text-[10px] text-market-muted">ELEMARKET Support only. Merchant contact is never exposed here.</p>}
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-full bg-market-green px-4 text-xs font-black text-white shadow-market-lg hover:bg-market-green/90" aria-label="Open ELEMARKET support chat">
          <MessageCircle size={17} /> Support
        </button>
      )}
    </div>
  );
}
