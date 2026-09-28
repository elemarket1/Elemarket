import { AdminDataBoundary } from "@/components/admin-data-boundary";
import { label } from "@/lib/admin/format";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminOrder, getAdminOrderSection } from "@/lib/admin/orders.functions";
import { manageAdminSupport } from "@/lib/admin/support-operations.functions";
import { requestAdminProviderRefund } from "./dashboard.functions";
import { orderSections } from "@/lib/admin/orders.schemas";
import { Fields, DataTable, Pagination, LoadError } from "@/components/admin-order-ui";
import { AdminSupportThread } from "@/components/admin-support-thread";
export const Route = createFileRoute("/admin/orders/$orderId")({
  component: () => (
    <AdminDataBoundary>
      <AdminOrderDetail />
    </AdminDataBoundary>
  ),
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow,noarchive" }] }),
});
function AdminOrderDetail() {
  const { orderId } = Route.useParams();
  const client = useQueryClient();
  const [section, setSection] = useState<
      (typeof orderSections)[number] | "overview" | "customer" | "merchant"
    >("overview"),
    [page, setPage] = useState(0),
    [conversation, setConversation] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  const openKey = useRef(crypto.randomUUID());
  const overview = useQuery({
    queryKey: ["admin-order", orderId],
    queryFn: () => getAdminOrder({ data: { orderId } }),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["admin-order-section", orderId, section, page],
    queryFn: () =>
      getAdminOrderSection({
        data: { orderId, section: section as (typeof orderSections)[number], page, pageSize: 20 },
      }),
    enabled:
      orderSections.includes(section as (typeof orderSections)[number]) && overview.isSuccess,
    retry: false,
  });
  async function openSupport() {
    setBusy(true);
    setError("");
    try {
      const result = await manageAdminSupport({
        data: { action: "open", orderId, conversationId: null, idempotencyKey: openKey.current },
      });
      setConversation(result.conversationId);
      await client.invalidateQueries({ queryKey: ["admin-order-section", orderId] });
    } catch {
      setError("Could not open support. Check your recent administrator MFA session.");
    } finally {
      setBusy(false);
    }
  }
  async function refund() {
    if (
      !window.confirm(
        "Request a refund from the payment provider for this order? This does not transfer funds inside ELEMARKET.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await requestAdminProviderRefund({ data: { orderId, note: note.trim() || undefined } });
      await client.invalidateQueries({ queryKey: ["admin-order", orderId] });
      await client.invalidateQueries({ queryKey: ["admin-order-section", orderId] });
    } catch {
      setError(
        "Refund could not be confirmed. Inspect the durable refund record and provider status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (overview.isPending)
    return (
      <main className="p-8" role="status">
        Loading order intelligence…
      </main>
    );
  if (overview.isError)
    return (
      <main className="p-8">
        <LoadError retry={() => void overview.refetch()} />
      </main>
    );
  const { order, withdrawal } = overview.data;
  const tabKeys = ["overview", "customer", "merchant", ...orderSections] as const;
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <nav className="flex gap-4 text-sm font-bold text-market-green">
        <a href="/admin/orders">All orders</a>
        <a href="/admin/support">Support inbox</a>
        <a href="/admin/dashboard">Operations</a>
      </nav>
      <header className="rounded-2xl border bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-widest text-market-muted">
          Order intelligence
        </p>
        <h1 className="mt-2 break-all text-2xl font-black">Order {orderId}</h1>
        <span className="mt-3 inline-flex rounded-full bg-market-soft px-3 py-1 text-sm font-bold">
          {label(String(order.status))}
        </span>
        <p className="mt-3 text-sm text-market-muted">
          Payment collection, settlement and refunds are managed by the provider. ELEMARKET’s
          24-hour eligibility policy does not guarantee a Paystack settlement hold.
        </p>
      </header>
      <nav aria-label="Order sections" className="flex flex-wrap gap-2">
        {tabKeys.map((t) => (
          <button
            key={t}
            onClick={() => {
              setSection(t);
              setPage(0);
            }}
            aria-pressed={t === section}
            className={`rounded-lg border px-3 py-2 text-sm font-bold ${section === t ? "bg-market-green text-white" : "bg-white"}`}
          >
            {label(t)}
          </button>
        ))}
      </nav>
      <section className="space-y-5 rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-black">{label(section)}</h2>
        {section === "overview" ? (
          <>
            <Fields
              row={order}
              keys={[
                "status",
                "createdAt",
                "updatedAt",
                "paymentDeadline",
                "deadlineElapsed",
                "groupId",
                "currency",
                "productTotal",
                "discount",
                "deliveryFee",
                "commission",
                "total",
                "paymentStatus",
                "deliveryStatus",
                "disputeStatus",
                "refundStatus",
                "deliveredAt",
                "customerReceivedAt",
                "deliveryConfirmationSource",
                "deliveryTier",
                "deliveryAddress",
              ]}
            />
            <h3 className="pt-3 font-bold">24-hour dispute window and merchant eligibility</h3>
            <Fields
              row={withdrawal}
              keys={[
                "eligible",
                "reason",
                "deliveredAt",
                "eligibleAt",
                "providerSettlementControlled",
                "deliveryHoldGuaranteed",
              ]}
            />
            <p className="text-sm text-market-muted">
              An elapsed deadline is not a delivery or settlement event. Policy timing is calculated
              on the server from persisted delivery and dispute records.
            </p>
          </>
        ) : section === "customer" ? (
          <>
            <Fields
              row={order}
              keys={[
                "customerName",
                "customerId",
                "customerEmail",
                "emailVerified",
                "customerPhone",
                "phoneVerifiedAt",
                "deliveryAddress",
                "groupId",
              ]}
            />
            <p className="text-sm text-market-muted">
              Only verified contact details are shown, masked. Order-related support appears in the
              Support section.
            </p>
          </>
        ) : section === "merchant" ? (
          <>
            <Fields
              row={order}
              keys={[
                "merchantName",
                "merchantId",
                "merchantStatus",
                "merchantVerified",
                "merchantAddress",
                "merchantCity",
                "settlementModel",
                "status",
              ]}
            />
            <p className="text-sm text-market-muted">
              Viewing this record does not impersonate the merchant or execute settlement.
            </p>
          </>
        ) : history.isPending ? (
          <p role="status">Loading records…</p>
        ) : history.isError ? (
          <LoadError retry={() => void history.refetch()} />
        ) : history.data ? (
          <>
            <DataTable
              rows={history.data.rows}
              onOpen={section === "support" ? (r) => setConversation(String(r.id)) : undefined}
            />
            <Pagination page={page} hasMore={history.data.hasMore} onPage={setPage} />
          </>
        ) : null}
        {section === "delivery" && (
          <p className="text-sm text-market-muted">
            Only persisted shipment/provider records are shown. An empty history means no delivery
            integration data is recorded. Tracking events are in Timeline.
          </p>
        )}
        {section === "timeline" && (
          <p className="text-sm text-market-muted">
            Chronological persisted records. Older orders may have incomplete event history. Future
            eligibility times are displayed in Overview and are not invented timeline events.
          </p>
        )}
        {section === "disputes" && (
          <p className="text-sm text-market-muted">
            The current dispute flow records a reason and resolution; separate evidence uploads and
            merchant responses are not recorded. Consult linked support for customer-provided
            context.
          </p>
        )}
        {section === "refunds" && (
          <div className="space-y-3 rounded-xl border border-red-200 p-4">
            <h3 className="font-bold">Explicit provider refund action</h3>
            <p className="text-sm">
              Eligibility is checked again on the server. A completed payment is required. Unknown
              outcomes require provider reconciliation and cannot be sent as a second refund.
            </p>
            <label className="block text-sm">
              Resolution note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <button
              disabled={busy || order.paymentStatus !== "completed"}
              onClick={() => void refund()}
              className="rounded bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-40"
            >
              Request provider refund
            </button>
          </div>
        )}
        {section === "support" && (
          <>
            <button
              disabled={busy}
              onClick={() => void openSupport()}
              className="rounded bg-market-green px-4 py-2 font-bold text-white"
            >
              Open customer conversation
            </button>
            {conversation && (
              <AdminSupportThread
                key={conversation}
                conversationId={conversation}
                orderId={orderId}
              />
            )}
          </>
        )}
        {busy && <p role="status">Processing…</p>}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
