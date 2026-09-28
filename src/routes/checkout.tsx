import { locationAttribution } from "@/lib/market/adapters/location";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CreditCard, LockKeyhole, ShieldCheck, ShoppingBag, Truck } from "lucide-react";
import { RedirectToSignIn, SignInGate } from "@/lib/auth/gates";
import { createPendingCheckout } from "@/lib/market/checkout";
import { getAssistedOrderDraft } from "@/lib/support.functions";
import { fingerprintCheckout } from "@/lib/market/checkout-fingerprint";
import { createPaymentIntent } from "@/lib/market/payment";
import { requestDeliveryQuote } from "@/lib/market/adapters/delivery";
import { resolveProductMerchants } from "@/lib/market/catalog";
import { formatGhs } from "@/lib/market/money";
import { previewCustomerFinancing, startCustomerFinancing, type FinancingProvider } from "@/lib/market/financing";
import { ContactSupportWidget } from "@/components/contact-support-widget";

import { PAYMENT_QUEUE_KEY, QUOTE_KEY, cartTotal, readCart, writeCart, type CartLine } from "@/lib/market/cart";

export const Route = createFileRoute("/checkout")({ component: Checkout });

function Checkout() {
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <CheckoutForm />
    </SignInGate>
  );
}

function CheckoutForm() {
  const attribution = useQuery({ queryKey: ["location-attribution"], queryFn: () => locationAttribution() });
  const [cart, setCart] = useState<CartLine[]>(readCart);
  const [assistedDraftId, setAssistedDraftId] = useState<string | null>(null);
  const [assistedDraftNotice, setAssistedDraftNotice] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<"mobile_money" | "card" | "bank_transfer">("mobile_money");
  const [promoCode, setPromoCode] = useState("");
  const [tier, setTier] = useState<"same_day" | "next_day" | "three_day">("next_day");
  const [quotes, setQuotes] = useState<Array<{ merchantId: string; quoteId: string; price: string; etaMinutes: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [financingProviders, setFinancingProviders] = useState<FinancingProvider[]>([]);
  const [financingQuote, setFinancingQuote] = useState<{ quoteId: string; amount: number; expiresAt: string } | null>(null);
  const [selectedFinancingProvider, setSelectedFinancingProvider] = useState("");
  const [financingStatus, setFinancingStatus] = useState<string | null>(null);
  const [financingBusy, setFinancingBusy] = useState(false);
  const total = useMemo(() => cartTotal(cart), [cart]);
  const deliveryTotal = quotes.reduce((sum, q) => sum + Number(q.price || 0), 0);

  useEffect(() => {
    const draftId = new URLSearchParams(window.location.search).get("draftId");
    if (!draftId) return;
    setAssistedDraftId(draftId);
    void getAssistedOrderDraft({ data: { draftId } }).then((draft) => {
      if (!draft || !Array.isArray((draft as any).items)) throw new Error("draft unavailable");
      const next = (draft as any).items.map((item: any) => ({
        productId: item.productId, variantId: item.variantId ?? null, quantity: Number(item.quantity),
        name: item.name, price: String(item.price), imagePath: null, merchantId: item.merchantId,
      }));
      setCart(next);
      setQuotes([]);
      setAssistedDraftNotice("Support prepared this order for you. Review the address, delivery quote and final total before payment.");
    }).catch(() => { setAssistedDraftId(null); setAssistedDraftNotice("This assisted order is no longer available. Please contact ELEMARKET Support."); });
  }, []);

  async function quote() {
    setError(null);
    if (!cart.length) return setError("Your cart is empty.");
    if (address.trim().length < 8) return setError("Enter a complete delivery address.");
    setBusy(true);
    try {
      const missing = cart.filter((line) => !line.merchantId).map((line) => line.productId);
      const resolved = missing.length ? await resolveProductMerchants({ data: { productIds: [...new Set(missing)] } }) : {};
      const merchantIds = [...new Set(cart.map((line) => line.merchantId || resolved[line.productId]).filter(Boolean))] as string[];
      if (!merchantIds.length) throw new Error("Could not resolve merchants for this cart.");
      const next: Array<{ merchantId: string; quoteId: string; price: string; etaMinutes: number }> = [];
      for (const merchantId of merchantIds) {
        const result = await requestDeliveryQuote({ data: { merchantId, address: address.trim(), tier } });
        if (!result?.id) throw new Error("Delivery provider did not return a quote.");
        next.push({ merchantId, quoteId: result.id, price: result.price, etaMinutes: result.etaMinutes });
      }
      setQuotes(next);
      localStorage.setItem(QUOTE_KEY, JSON.stringify(next));
    } catch (e) {
      setError("Could not quote delivery. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareFinancing() {
    setFinancingStatus(null);
    if (!quotes.length) return setFinancingStatus("Get a live delivery quote before requesting financing.");
    setFinancingBusy(true);
    try {
      const preview = await previewCustomerFinancing({
        data: {
          items: cart.map(({ productId, variantId, quantity }) => ({ productId, variantId: variantId ?? null, quantity })),
          quoteIds: quotes.map((q) => q.quoteId),
        },
      });
      setFinancingQuote({ quoteId: preview.quoteId, amount: preview.amount, expiresAt: preview.expiresAt });
      setFinancingProviders(preview.providers);
      if (!selectedFinancingProvider && preview.providers[0]) setSelectedFinancingProvider(preview.providers[0].id);
      if (!preview.providers.length) setFinancingStatus("No financing provider is currently available for this purchase.");
    } catch {
      setFinancingStatus("Financing options could not be loaded. Please try again.");
    } finally {
      setFinancingBusy(false);
    }
  }

  async function applyForFinancing() {
    if (!financingQuote || !selectedFinancingProvider) return;
    setFinancingBusy(true);
    setFinancingStatus(null);
    try {
      const result = await startCustomerFinancing({
        data: {
          providerId: selectedFinancingProvider,
          quoteId: financingQuote.quoteId,
          orderGroupId: undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      setFinancingStatus("Your financing application has been started. The selected provider must review and approve it. ELEMARKET does not approve or guarantee financing.");
    } catch {
      setFinancingStatus("The financing application could not be started. Please try again.");
    } finally {
      setFinancingBusy(false);
    }
  }

  async function submit() {
    setError(null);
    if (!cart.length) return setError("Your cart is empty.");
    if (address.trim().length < 8) return setError("Enter a complete delivery address.");
    setBusy(true);
    try {
      const stored = quotes.length ? quotes : JSON.parse(localStorage.getItem(QUOTE_KEY) || "[]");
      if (!Array.isArray(stored) || stored.length === 0) {
        throw new Error("Delivery pricing is not available yet. Get a live delivery quote before placing the order.");
      }
      const payload = {
        items: cart.map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity })),
        quotes: stored.map(({ merchantId, quoteId }) => ({ merchantId, quoteId })),
        address: address.trim(),
        method,
        promoCode: promoCode.trim() || null,
        assistedDraftId,
      };
      const fingerprint = await fingerprintCheckout(payload);
      const result = await createPendingCheckout({ data: { ...payload, fingerprint, idempotencyKey: crypto.randomUUID() } });
      if (!result) throw new Error("Checkout could not be created.");
      const orders = Array.isArray((result as { orders?: Array<{ paymentId?: string }> }).orders)
        ? (result as { orders: Array<{ paymentId?: string }> }).orders
        : [];
      const paymentIds = orders.map((o) => o.paymentId).filter((id): id is string => typeof id === "string" && id.length > 0);
      if (!paymentIds.length) throw new Error("No payable order was created.");
      const queue: Array<{ paymentId: string }> = [];
      let firstCheckoutUrl: string | null = null;
      for (const paymentId of paymentIds) {
        const intent = await createPaymentIntent({ data: { paymentId } });
        if (!intent?.checkoutUrl) throw new Error("The payment provider did not return a secure checkout URL.");
        queue.push({ paymentId });
        if (!firstCheckoutUrl) firstCheckoutUrl = intent.checkoutUrl;
      }
      localStorage.setItem(PAYMENT_QUEUE_KEY, JSON.stringify(queue));
      writeCart([]);
      // Never trust a provider URL persisted in browser storage. The first
      // provider URL came directly from the server response above; it is
      // intentionally used immediately, while subsequent URLs are re-issued
      // server-side on the return page after ownership is re-checked.
      if (!firstCheckoutUrl) throw new Error("The payment provider did not return a secure checkout URL.");
      window.location.href = firstCheckoutUrl;
    } catch (e) {
      setError("Checkout could not be completed. Please review your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!cart.length) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold"><ArrowLeft size={16} /> Back to marketplace</Link>
        <div className="mt-12 rounded-3xl border border-market-line bg-white p-10 text-center shadow-market">
          <ShoppingBag className="mx-auto text-market-green" size={42} />
          <h1 className="mt-4 text-3xl font-black">Your cart is empty</h1>
          <Link to="/" className="mt-6 inline-flex rounded-xl bg-market-orange px-5 py-3 font-black text-white">Continue shopping</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-market-bg">
      <ContactSupportWidget mode="order" />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold"><ArrowLeft size={16} /> Marketplace</Link>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-3xl border border-market-line bg-white p-5 shadow-market sm:p-7">
            {assistedDraftNotice && <div role="status" className="mb-5 rounded-2xl border border-market-green/20 bg-market-soft p-4 text-sm font-semibold text-market-muted">{assistedDraftNotice}</div>}
            <div className="flex items-center gap-3">
              <Truck className="text-market-green" />
              <div>
                <h1 className="text-2xl font-black">Checkout</h1>
                <p className="text-sm text-market-muted">Secure order creation. Payment is completed separately.</p>
              </div>
            </div>
            <label className="mt-7 block text-sm font-black">
              Delivery address
              <input
                value={address}
                onChange={(e) => { setAddress(e.target.value); setQuotes([]); }}
                maxLength={400}
                className="mt-2 h-12 w-full rounded-xl border border-market-line px-4 outline-none focus:border-market-green"
                placeholder="Street, area, city"
              />
            </label>
            <div className="mt-6">
              <p className="text-sm font-black">Delivery speed</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([["same_day", "Same day"], ["next_day", "Next day"], ["three_day", "3-day"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => { setTier(id); setQuotes([]); }} className={`rounded-xl border px-4 py-3 text-sm font-black ${tier === id ? "border-market-green bg-market-green/10" : "border-market-line"}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="mt-7">
              <p className="text-sm font-black">Payment method</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([["mobile_money", "Mobile Money"], ["card", "Card"], ["bank_transfer", "Bank"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setMethod(id)} className={`rounded-xl border px-4 py-3 text-sm font-black ${method === id ? "border-market-green bg-market-green/10" : "border-market-line"}`}>
                    <CreditCard size={16} className="mr-2 inline" />{label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-7 rounded-2xl border border-market-line bg-market-soft p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 shrink-0 text-market-green" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black">Pay over time</p>
                  <p className="mt-1 text-xs leading-5 text-market-muted">BNPL and installment financing are separate provider applications, not ELEMARKET payment methods. Every application is subject to the selected provider's approval, terms and availability.</p>
                  {!financingQuote ? (
                    <button type="button" onClick={() => void prepareFinancing()} disabled={financingBusy || quotes.length === 0} className="mt-3 rounded-xl border border-market-green bg-white px-4 py-2.5 text-xs font-black text-market-green disabled:cursor-not-allowed disabled:opacity-50">
                      {financingBusy ? "Loading financing options…" : "View BNPL / installment options"}
                    </button>
                  ) : financingProviders.length ? (
                    <div className="mt-3 space-y-2">
                      {financingProviders.map((provider) => (
                        <label key={provider.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 ${selectedFinancingProvider === provider.id ? "border-market-green" : "border-market-line"}`}>
                          <input type="radio" name="financing-provider" value={provider.id} checked={selectedFinancingProvider === provider.id} onChange={() => setSelectedFinancingProvider(provider.id)} />
                          <span className="min-w-0 flex-1"><span className="block text-sm font-black">{provider.name}</span><span className="block text-[11px] font-semibold text-market-muted">{provider.productType === "bnpl" ? "BNPL" : "Installment financing"} · Provider approval required</span></span>
                        </label>
                      ))}
                      <p className="text-[11px] leading-5 text-market-muted">Indicative application amount: {formatGhs(financingQuote.amount)}. This is not an approved credit limit. Final amount, contribution, fees, schedule and approval come only from the provider.</p>
                      <button type="button" onClick={() => void applyForFinancing()} disabled={financingBusy || !selectedFinancingProvider} className="w-full rounded-xl bg-market-green px-4 py-3 text-xs font-black text-white disabled:opacity-50">{financingBusy ? "Starting provider application…" : "Apply with selected provider"}</button>
                    </div>
                  ) : null}
                  {financingStatus && <p role="status" className="mt-3 rounded-xl border border-market-line bg-white p-3 text-xs font-semibold text-market-muted">{financingStatus}</p>}
                  {!financingProviders.length && financingQuote && <div className="mt-3 rounded-xl border border-dashed border-market-line bg-white p-3 text-[11px] leading-5 text-market-muted"><b className="text-market-ink">Buy now, pay later:</b> this option appears only when an approved financing-provider integration is activated. Availability, amount, terms and approval always come from the provider.</div>}
                </div>
              </div>
            </div>
            <label className="mt-7 block text-sm font-black">
              Promo code (optional)
              <input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64))}
                maxLength={64}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="mt-2 h-12 w-full rounded-xl border border-market-line px-4 uppercase outline-none focus:border-market-green"
                placeholder="ENTER CODE"
              />
              <span className="mt-1 block text-xs font-normal text-market-muted">Discounts are re-validated server-side at order creation. Codes cannot change the delivery quote.</span>
            </label>
            <div className="mt-7 rounded-2xl bg-market-soft p-4">
              <div className="flex gap-3">
                <ShieldCheck className="shrink-0 text-market-green" />
                <p className="text-xs leading-5 text-market-muted">ELEMARKET never treats a browser-supplied price as authoritative. Inventory, product price, merchant ownership and delivery quote validity are verified server-side.</p>
              </div>
            </div>
            {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
            {quotes.length === 0 ? (
              <button disabled={busy} onClick={quote} className="mt-7 h-12 w-full rounded-xl bg-market-green font-black text-white disabled:opacity-50">
                {busy ? "Requesting live quote…" : "Get a live delivery quote"}
              </button>
            ) : (
              <button disabled={busy} onClick={submit} className="mt-7 h-12 w-full rounded-xl bg-market-orange font-black text-white disabled:opacity-50">
                {busy ? "Creating secure order…" : "Continue to secure payment"}
              </button>
            )}
          </section>
          <aside className="h-fit rounded-3xl border border-market-line bg-white p-5 shadow-market sm:p-7">
            <h2 className="text-lg font-black">Order summary</h2>
            <div className="mt-5 space-y-3">
              {cart.map((item, i) => (
                <div key={`${item.productId}:${item.variantId}:${i}`} className="flex justify-between gap-3 text-sm">
                  <span className="font-semibold">{item.name || "Product"} × {item.quantity}</span>
                  <span className="font-black">{formatGhs(Number(item.price || 0) * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-between border-t border-market-line pt-5">
              <span className="font-black">Products</span>
              <span className="text-xl font-black">{formatGhs(total)}</span>
            </div>
            {quotes.length > 0 && (
              <div className="mt-3 flex justify-between text-sm">
                <span className="font-bold text-market-muted">Delivery</span>
                <span className="font-black">{formatGhs(deliveryTotal)}</span>
              </div>
            )}
            <p className="mt-3 text-xs text-market-muted">Delivery is quoted separately and must be live, unexpired and tied to this address before an order is created.</p><p className="mt-2 text-[11px] text-market-muted">{attribution.data?.map((item, index) => <span key={item.href}>{index ? " and " : "Location lookup powered by "}<a href={item.href} target="_blank" rel="noreferrer" className="underline">{item.label}</a></span>)}</p>
            <div className="mt-5 flex items-center gap-2 text-xs font-bold"><LockKeyhole size={14} /> Protected checkout</div>
          </aside>
        </div>
      </div>
    </main>
  );
}
