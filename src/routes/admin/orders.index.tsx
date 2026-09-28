import { AdminDataBoundary } from "@/components/admin-data-boundary";
import { label } from "@/lib/admin/format";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchAdminOrders } from "@/lib/admin/orders.functions";
import { orderStatuses, supportStatuses, type OrderSearchInput } from "@/lib/admin/orders.schemas";
import { DataTable, Pagination, LoadError } from "@/components/admin-order-ui";
export const Route = createFileRoute("/admin/orders/")({
  component: () => (
    <AdminDataBoundary>
      <AdminOrders />
    </AdminDataBoundary>
  ),
  head: () => ({ meta: [{ name: "robots", content: "noindex,nofollow,noarchive" }] }),
});
function AdminOrders() {
  const [filters, setFilters] = useState<Record<string, string>>({ searchBy: "order" });
  const [applied, setApplied] = useState<OrderSearchInput>({
    page: 0,
    pageSize: 20,
    searchBy: "order",
  });
  const [invalid, setInvalid] = useState("");
  const result = useQuery({
    queryKey: ["admin-order-search", applied],
    queryFn: () => searchAdminOrders({ data: applied }),
    retry: false,
  });
  function apply(e: React.FormEvent) {
    e.preventDefault();
    setInvalid("");
    try {
      const data: Record<string, unknown> = { page: 0, pageSize: 20 };
      for (const [k, v] of Object.entries(filters))
        if (v.trim()) data[k] = ["from", "to"].includes(k) ? new Date(v).toISOString() : v.trim();
      setApplied(data as OrderSearchInput);
    } catch {
      setInvalid("Check the date range.");
    }
  }
  const field = (key: string, title: string, options?: readonly string[], type = "text") => (
    <label key={key} className="block text-sm font-bold">
      {title}
      {options ? (
        <select
          value={filters[key] ?? ""}
          onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
          className="mt-1 w-full rounded-lg border p-2"
        >
          {key !== "searchBy" && <option value="">Any</option>}
          {options.map((v) => (
            <option key={v} value={v}>
              {label(v)}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={filters[key] ?? ""}
          maxLength={128}
          type={type}
          onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
          className="mt-1 w-full rounded-lg border p-2"
        />
      )}
    </label>
  );
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <nav className="flex gap-4 text-sm font-bold text-market-green">
        <a href="/admin/dashboard">Operations</a>
        <a href="/admin/support">Support inbox</a>
      </nav>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-market-muted">
          ELEMARKET Operations
        </p>
        <h1 className="mt-2 text-3xl font-black">Orders</h1>
        <p className="mt-2 text-sm text-market-muted">
          Exact order numbers use the existing order ID. Search is server-side and paginated.
        </p>
      </header>
      <form onSubmit={apply} className="space-y-4 rounded-2xl border bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {field("searchBy", "Search by", ["order", "payment_reference", "customer", "merchant"])}
          {field("query", "Exact identifier / reference")}
          {field("status", "Order status", orderStatuses)}
          {field("paymentStatus", "Payment status", [
            "initiated",
            "authorized",
            "completed",
            "failed",
            "refunded",
          ])}
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-bold">More filters</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {field("customerId", "Customer account ID")}
            {field("merchantId", "Merchant ID")}
            {field("deliveryStatus", "Delivery status", [
              "pending",
              "packed",
              "shipped",
              "in_transit",
              "out_for_delivery",
              "delivered",
              "failed",
              "cancelled",
              "returned",
            ])}
            {field("disputeStatus", "Dispute status", [
              "open",
              "under_review",
              "resolved_refund",
              "closed",
            ])}
            {field("refundStatus", "Refund status", [
              "requested",
              "processing",
              "processed",
              "needs_attention",
              "failed",
              "cancelled",
            ])}
            {field("supportStatus", "Support status", supportStatuses)}
            {field("from", "Created from", undefined, "datetime-local")}
            {field("to", "Created through", undefined, "datetime-local")}
          </div>
        </details>
        <button className="rounded-lg bg-market-green px-5 py-2 font-bold text-white">
          Search orders
        </button>
        {invalid && <p role="alert">{invalid}</p>}
      </form>
      {result.isPending ? (
        <p role="status">Loading orders…</p>
      ) : result.isError ? (
        <LoadError retry={() => void result.refetch()} />
      ) : (
        <>
          <DataTable
            rows={result.data.rows}
            onOpen={(row) =>
              window.location.assign(`/admin/orders/${encodeURIComponent(String(row.id))}`)
            }
          />
          <Pagination
            page={applied.page ?? 0}
            hasMore={result.data.hasMore}
            onPage={(page) => setApplied({ ...applied, page })}
          />
        </>
      )}
    </main>
  );
}
