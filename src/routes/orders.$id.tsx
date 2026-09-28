import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getCustomerOrder,
  openCustomerOrderDispute,
  cancelCustomerOrder,
} from "@/lib/market/orders";
import {
  confirmOrderReceived,
  requestOrderReturn,
  submitOrderItemReview,
} from "@/lib/market/post-purchase";
import { SignInGate } from "@/lib/auth/gates";
import { formatGhs } from "@/lib/market/money";

export const Route = createFileRoute("/orders/$id")({ component: OrderDetail });
function OrderDetail() {
  const { id } = Route.useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof getCustomerOrder>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [returnItemId, setReturnItemId] = useState<number | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [reviewItem, setReviewItem] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setNotice(null);
    void getCustomerOrder({ data: { orderId: id } })
      .then((r) => {
        if (active) setData(r);
      })
      .catch(() => {
        if (active) setError("We couldn't load this order.");
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function dispute() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await openCustomerOrderDispute({ data: { orderId: id, reason } });
      setNotice(
        r.existing ? "A dispute is already open for this order." : "Your dispute has been opened.",
      );
      const fresh = await getCustomerOrder({ data: { orderId: id } });
      setData(fresh);
    } catch {
      setError("We couldn't open the dispute. Please check the order status and try again.");
    } finally {
      setBusy(false);
    }
  }
  async function requestReturn(itemId: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestOrderReturn({
        data: {
          orderId: id,
          orderItemId: itemId,
          reasonCode: "other",
          reason: returnReason.trim(),
          quantity: 1,
        },
      });
      setNotice("Your return request has been submitted to ELEMARKET support/merchant review.");
      setReturnItemId(null);
      setReturnReason("");
    } catch {
      setError(
        "We could not submit the return request. Check the return window and item eligibility.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitReview(productId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await submitOrderItemReview({
        data: { orderId: id, productId, rating: reviewRating, body: reviewBody.trim() },
      });
      setNotice("Your verified purchase review has been submitted.");
      setReviewItem(null);
      setReviewBody("");
    } catch {
      setError("We could not submit the review. You may already have reviewed this item.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmReceived() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await confirmOrderReceived({ data: { orderId: id } });
      setNotice("Receipt confirmed. The 24-hour customer protection window has started.");
      setData(await getCustomerOrder({ data: { orderId: id } }));
    } catch {
      setError("We could not confirm receipt. The order may not be ready for confirmation.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await cancelCustomerOrder({ data: { orderId: id } });
      setNotice(
        result.refundStatus === "not_required"
          ? "Order cancelled. No payment refund was needed."
          : result.refundStatus === "needs_attention"
            ? "Your refund needs provider review. Contact support to track its resolution."
            : result.refundStatus === "processed"
              ? "Your payment provider has confirmed the refund."
              : "Cancellation/refund processing has started with the payment provider.",
      );
      const fresh = await getCustomerOrder({ data: { orderId: id } });
      setData(fresh);
    } catch {
      setError(
        "We couldn't cancel this order. It may already be processing or no longer be cancellable.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-market-bg px-4 py-8 sm:px-6">
      <section className="mx-auto max-w-3xl">
        <Link to="/orders" className="text-sm font-bold text-market-green">
          ← My orders
        </Link>
        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700"
          >
            {error}
          </div>
        )}
        {data && (
          <>
            <div className="mt-5 rounded-3xl border border-market-line bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-market-muted">
                    Order
                  </p>
                  <h1 className="mt-1 text-2xl font-black">{data.order.id}</h1>
                  <p className="mt-2 text-sm text-market-muted">
                    {new Date(data.order.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-market-soft px-3 py-1 text-xs font-black capitalize">
                  {data.order.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="mt-6 divide-y divide-market-line">
                {data.items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-bold">Item {i.productId}</p>
                      <p className="text-sm text-market-muted">Qty {i.quantity}</p>
                    </div>
                    <p className="font-black">{formatGhs(Number(i.productTotal))}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex justify-between border-t border-market-line pt-5">
                <span className="font-bold">Total</span>
                <span className="text-xl font-black">
                  {formatGhs(Number(data.order.grand_total))}
                </span>
              </div>
            </div>
            <div className="mt-4 rounded-3xl border border-market-line bg-white p-6">
              <h2 className="text-lg font-black">Need help with this order?</h2>
              <p className="mt-2 text-sm text-market-muted">
                Chat with ELEMARKET Support about this specific order.
              </p>
              <a
                href={`/support?orderId=${encodeURIComponent(id)}`}
                className="mt-4 inline-flex rounded-xl bg-market-green px-4 py-3 text-sm font-black text-white"
              >
                Chat with ELEMARKET Support
              </a>
            </div>
            <div className="mt-4 rounded-3xl border border-market-line bg-white p-6">
              <h2 className="text-lg font-black">Order actions</h2>
              <p className="mt-2 text-sm leading-6 text-market-muted">
                Refunds are handled through the payment provider. Disputes are recorded by ELEMARKET
                and reviewed without ELEMARKET holding customer funds.
              </p>
              {data.order.status === "shipped" && (
                <button
                  disabled={busy}
                  onClick={confirmReceived}
                  className="mt-4 rounded-xl bg-market-green px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  Confirm I received this order
                </button>
              )}
              {["payment_pending", "paid", "confirmed"].includes(data.order.status) && (
                <button
                  disabled={busy}
                  onClick={cancel}
                  className="mt-4 rounded-xl border border-market-line px-4 py-3 text-sm font-black disabled:opacity-50"
                >
                  Cancel order
                </button>
              )}
              {[
                "paid",
                "confirmed",
                "fulfilling",
                "shipped",
                "delivered",
                "completed",
                "disputed",
              ].includes(data.order.status) && (
                <div className="mt-6">
                  <label className="block text-sm font-bold">
                    Open a customer dispute
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={8}
                      maxLength={2000}
                      placeholder="Describe the problem with this order"
                      className="mt-2 min-h-28 w-full rounded-xl border border-market-line px-3 py-3"
                    />
                  </label>
                  <button
                    disabled={busy || reason.trim().length < 8}
                    onClick={dispute}
                    className="mt-3 rounded-xl bg-market-green px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                  >
                    {busy ? "Processing…" : "Open dispute"}
                  </button>
                </div>
              )}
              {notice && (
                <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-700">
                  {notice}
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
