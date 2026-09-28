import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listCustomerOrders } from "@/lib/market/orders";
import { SignInGate } from "@/lib/auth/gates";
import { formatGhs } from "@/lib/market/money";

type OrderSummary = Awaited<ReturnType<typeof listCustomerOrders>>["orders"][number];

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CustomerOrders() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void listCustomerOrders({ data: { limit: 20 } })
      .then((r) => {
        if (!active) return;
        setOrders(r.orders);
        setNext(r.nextCursor);
      })
      .catch(() => {
        if (active) setError("We couldn't load your orders. Please try again.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="min-h-screen bg-market-bg px-4 py-8 sm:px-6">
      <section className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link to="/" className="text-2xl font-black tracking-[-.04em] text-market-green">
              ELE<span className="text-market-orange">MARKET</span>
            </Link>
            <h1 className="mt-6 text-3xl font-black">My orders</h1>
            <p className="mt-2 text-sm text-market-muted">
              Track purchases, delivery, disputes and provider refunds.
            </p>
          </div>
          <Link to="/profile" className="rounded-xl bg-white px-4 py-2 text-sm font-bold shadow-sm">
            Profile
          </Link>
        </div>
        <SignInGate
          fallback={
            <div className="mt-8 rounded-2xl border border-market-line bg-white p-6">
              <p className="font-bold">Sign in to view your orders.</p>
              <Link
                to="/login"
                className="mt-4 inline-flex rounded-xl bg-market-green px-4 py-3 text-sm font-black text-white"
              >
                Sign in
              </Link>
            </div>
          }
        >
          <div className="mt-8 space-y-3">
            {busy && (
              <div className="rounded-2xl border border-market-line bg-white p-6 text-sm text-market-muted">
                Loading orders…
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-700"
              >
                {error}
              </div>
            )}
            {!busy && !error && orders.length === 0 && (
              <div className="rounded-2xl border border-market-line bg-white p-8 text-center">
                <p className="font-bold">No orders yet.</p>
                <Link
                  to="/"
                  className="mt-4 inline-flex rounded-xl bg-market-green px-4 py-3 text-sm font-black text-white"
                >
                  Start shopping
                </Link>
              </div>
            )}
            {orders.map((o) => (
              <Link
                key={o.id}
                to="/orders/$id"
                params={{ id: o.id }}
                className="block rounded-2xl border border-market-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-market-muted">
                      Order {o.id}
                    </p>
                    <p className="mt-1 text-sm text-market-muted">
                      {new Date(o.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded-full bg-market-soft px-3 py-1 text-xs font-black capitalize">
                    {statusLabel(o.status)}
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-market-muted">Total</p>
                    <p className="text-xl font-black">{formatGhs(Number(o.grandTotal))}</p>
                  </div>
                  {o.disputeStatus && (
                    <div className="text-right">
                      <p className="text-xs text-market-muted">Dispute</p>
                      <p className="text-sm font-bold">{statusLabel(o.disputeStatus)}</p>
                    </div>
                  )}
                </div>
              </Link>
            ))}
            {next && (
              <button
                disabled={loadingMore}
                onClick={async () => {
                  if (!next) return;
                  setLoadingMore(true);
                  try {
                    const r = await listCustomerOrders({ data: { limit: 20, cursor: next } });
                    setOrders((v) => [...v, ...r.orders]);
                    setNext(r.nextCursor);
                  } finally {
                    setLoadingMore(false);
                  }
                }}
                className="rounded-xl bg-white px-4 py-3 text-sm font-bold shadow-sm"
              >
                Load more
              </button>
            )}
          </div>
        </SignInGate>
      </section>
    </main>
  );
}
