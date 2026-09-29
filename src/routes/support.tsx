import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Headphones, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { RedirectToSignIn, SignInGate } from "@/lib/auth/gates";
import { getSupportConversation, sendSupportMessage } from "@/lib/support.functions";

export const Route = createFileRoute("/support")({ component: SupportPage });

function SupportPage() {
  return <SignInGate fallback={<RedirectToSignIn />}><SupportChat /></SignInGate>;
}

function SupportChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; senderType: string; body: string; createdAt: string }>>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<any | null>(null);

  async function load() {
    try {
      const orderId = new URLSearchParams(window.location.search).get("orderId");
      const result = await getSupportConversation({ data: { orderId: orderId?.trim() || null } });
      setConversationId(result.id);
      setMessages(result.messages);
      setDraft((result as any).draft ?? null);
    } catch (error) {
      console.error("[support] conversation load failed", error);
      setError("ELEMARKET Support is unavailable right now.");
    }
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const refresh = async () => {
      if (!active) return;
      try {
        await load();
      } catch {
        // load() already surfaces a safe customer-facing error.
      }
    };

    void refresh();
    timer = setInterval(() => { void refresh(); }, 5000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  async function send() {
    const text = body.trim();
    if (!text || !conversationId || busy) return;
    setBusy(true); setError(null);
    try {
      await sendSupportMessage({ data: { conversationId, body: text, idempotencyKey: crypto.randomUUID() } });
      setBody("");
      await load();
    } catch (error) {
      console.error("[support] message send failed", error);
      setError("Message could not be sent. Please try again.");
    }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-market-bg px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-market-muted hover:text-market-green"><ArrowLeft size={16} /> Marketplace</Link>
        <section className="mt-5 overflow-hidden rounded-3xl border border-market-line bg-white shadow-market">
          <header className="flex items-center gap-3 border-b border-market-line px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-market-soft text-market-green"><Headphones size={18}/></span>
            <div><h1 className="text-lg font-black">ELEMARKET Support</h1><p className="text-xs text-market-muted">Chat directly with the ELEMARKET support team.</p></div>
          </header>
          <div className="min-h-[420px] space-y-3 p-5">
            {draft && <div className="rounded-2xl border border-market-green/20 bg-market-soft p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">Order prepared by ELEMARKET Support</p><p className="mt-1 text-xs text-market-muted">Review the live order details before continuing to secure payment.</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-market-green">Review required</span></div>
              <div className="mt-3 space-y-2">{(draft.items ?? []).map((item: any) => <div key={`${item.productId}:${item.variantId ?? "base"}`} className="flex justify-between gap-3 text-xs"><span className="font-semibold">{item.name} × {item.quantity}</span><span className="font-black">GHS {Number(item.price || 0) * Number(item.quantity || 0)}</span></div>)}</div>
              <a href={`/checkout?draftId=${encodeURIComponent(draft.draftId)}`} className="mt-4 inline-flex w-full justify-center rounded-xl bg-market-orange px-4 py-3 text-xs font-black text-white">Review & continue to payment</a>
              <p className="mt-2 text-[10px] leading-4 text-market-muted">The agent cannot pay on your behalf. Prices, stock and delivery are checked again at checkout.</p>
            </div>}
            {messages.length === 0 && !draft && <p className="rounded-2xl bg-market-soft p-4 text-sm text-market-muted">Tell us what you need help with. For order issues, use Order Support from your cart or order page.</p>}
            {messages.map((message) => <div key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${message.senderType === "customer" ? "ml-auto bg-market-green text-white" : "bg-market-soft text-market-ink"}`}>{message.body}</div>)}
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          </div>
          <div className="border-t border-market-line p-3">
            <div className="flex items-end gap-2">
              <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 4000))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={2} maxLength={4000} placeholder="Write a message…" className="min-h-12 flex-1 resize-none rounded-xl border border-market-line px-3 py-2.5 text-sm outline-none focus:border-market-green" aria-label="Support message" />
              <button type="button" onClick={() => void send()} disabled={busy || !body.trim() || !conversationId} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-market-orange text-white disabled:opacity-40" aria-label="Send support message"><Send size={17}/></button>
            </div>
            <p className="mt-2 text-[10px] text-market-muted">ELEMARKET Support only. We never expose direct merchant contact through this chat.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
