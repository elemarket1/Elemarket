import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Minus, Plus, ShoppingBag, Trash2, ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatGhs } from "@/lib/market/money";
import { cartCount, cartTotal, readCart, writeCart, type CartLine } from "@/lib/market/cart";
import { ContactSupportWidget } from "@/components/contact-support-widget";

export const Route = createFileRoute("/cart")({ component: Cart });

function Cart() {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartLine[]>(readCart);
  useEffect(() => {
    writeCart(cart);
  }, [cart]);
  useEffect(() => {
    const sync = () => setCart(readCart());
    window.addEventListener("elemarket:cart-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("elemarket:cart-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const total = useMemo(() => cartTotal(cart), [cart]);
  const update = (index: number, delta: number) =>
    setCart((c) => c.map((x, i) => (i === index ? { ...x, quantity: Math.max(0, x.quantity + delta) } : x)).filter((x) => x.quantity > 0));
  return (
    <main className="min-h-screen bg-market-bg">
      <ContactSupportWidget mode="order" />
      <header className="sticky top-0 z-40 border-b border-market-line/80 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="text-xl font-black tracking-[-0.04em] text-market-green">ELE<span className="text-market-orange">MARKET</span></Link>
          <Link to="/cart" aria-label={`Cart, ${cartCount(cart)} items`} className="relative rounded-xl border border-market-line p-2.5"><ShoppingBag size={19}/>{cartCount(cart) > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-market-orange px-1.5 py-0.5 text-center text-[10px] font-black text-white">{cartCount(cart)}</span>}</Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:px-6 lg:px-8">
        <Link to="/" className="text-sm font-bold text-market-muted hover:text-market-green">← Marketplace</Link>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section className="rounded-3xl border border-market-line bg-white p-5 shadow-market sm:p-7">
            <h1 className="text-3xl font-black">Your cart</h1>
            {cart.length === 0 ? (
              <div className="py-16 text-center">
                <ShoppingBag className="mx-auto text-market-green" size={42} />
                <p className="mt-4 font-bold">Your cart is empty.</p>
                <Link to="/" className="mt-5 inline-flex rounded-xl bg-market-green px-5 py-3 text-sm font-black text-white">Continue shopping</Link>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {cart.map((item, i) => (
                  <div key={`${item.productId}:${item.variantId ?? "base"}:${i}`} className="flex min-w-0 gap-3 rounded-2xl border border-market-line p-3">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-market-soft">
                      {item.imagePath && <img src={item.imagePath} alt={item.name} className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="min-w-0 truncate font-bold">{item.name}</p>
                      <p className="mt-1 text-sm font-black">{formatGhs(item.price)}</p>
                      <div className="mt-2 flex items-center gap-1">
                        <button onClick={() => update(i, -1)} className="rounded-lg border p-1.5" aria-label="Decrease quantity"><Minus size={14} /></button>
                        <span className="w-7 text-center text-sm font-black">{item.quantity}</span>
                        <button onClick={() => update(i, 1)} className="rounded-lg border p-1.5" aria-label="Increase quantity"><Plus size={14} /></button>
                        <button onClick={() => setCart((c) => c.filter((_, j) => j !== i))} className="ml-2 rounded-lg p-1.5 text-red-600" aria-label="Remove item"><Trash2 size={15} /></button>
                      </div>
                    </div>
                    <p className="shrink-0 text-right text-sm font-black sm:text-base">{formatGhs(Number(item.price) * item.quantity)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
          {cart.length > 0 && (
            <aside className="h-fit rounded-3xl border border-market-line bg-white p-5 shadow-market sm:p-7">
              <h2 className="text-lg font-black">Summary</h2>
              <div className="mt-5 flex justify-between border-t border-market-line pt-4">
                <span className="font-black">Products</span>
                <strong className="text-xl">{formatGhs(total)}</strong>
              </div>
              <p className="mt-3 text-xs text-market-muted">Delivery is calculated from a live provider quote at checkout.</p>
              <button onClick={() => navigate({ to: "/checkout" })} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-market-orange font-black text-white">
                Continue to checkout <ArrowRight size={17} />
              </button>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
