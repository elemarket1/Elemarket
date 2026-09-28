import { AdminDataBoundary } from "@/components/admin-data-boundary";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Pagination } from "@/components/admin-order-ui";
import { AdminSupportThread } from "@/components/admin-support-thread";
import { getAdminAccessState } from "./access.functions";
import {
  createAssistedOrderDraft,
  listSupportInbox,
  searchProductsForAssistedOrder,
  type SupportInboxRow,
} from "@/lib/admin-support.functions";

export const Route = createFileRoute("/admin/support")({
  loader: async () => {
    const access = await getAdminAccessState();
    if (!access.authenticated || !access.isAdmin) throw redirect({ to: "/admin" });
    return listSupportInbox();
  },
  component: () => (
    <AdminDataBoundary>
      <AdminSupport />
    </AdminDataBoundary>
  ),
});

function AdminSupport() {
  const [inbox, setInbox] = useState<SupportInboxRow[]>(Route.useLoaderData() as SupportInboxRow[]);
  const [inboxPage, setInboxPage] = useState(0);
  const [inboxStatus, setInboxStatus] = useState<"active" | "all" | "closed" | "resolved">(
    "active",
  );
  const [inboxError, setInboxError] = useState(false);
  async function loadInbox(page: number, status: typeof inboxStatus = inboxStatus) {
    try {
      const rows = await listSupportInbox({ data: { page, status } });
      setInbox(rows);
      setInboxPage(page);
      setInboxStatus(status);
      setSelected(rows[0]?.id ?? null);
      setInboxError(false);
    } catch {
      setInboxError(true);
    }
  }
  const [selected, setSelected] = useState(inbox[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  async function findProducts() {
    if (search.trim().length < 2) return;
    try {
      setResults(await searchProductsForAssistedOrder({ data: { q: search.trim() } }));
    } catch {
      setResults([]);
    }
  }
  function addDraftItem(product: any, variant: any = null) {
    const existing = draftItems.find(
      (i) => i.productId === product.id && (i.variantId || null) === (variant?.id || null),
    );
    if (existing) {
      setDraftItems(
        draftItems.map((i) =>
          i === existing ? { ...i, quantity: Math.min(20, i.quantity + 1) } : i,
        ),
      );
    } else
      setDraftItems([
        ...draftItems,
        {
          productId: product.id,
          variantId: variant?.id ?? null,
          quantity: 1,
          name: variant?.name || product.name,
          price: variant?.price || product.price,
          merchantId: product.merchantId,
          merchantName: product.merchantName,
        },
      ]);
  }
  async function createDraft() {
    if (!selected || !draftItems.length || draftBusy) return;
    setDraftBusy(true);
    setDraftNotice(null);
    try {
      const result: any = await createAssistedOrderDraft({
        data: {
          conversationId: selected,
          items: draftItems.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
          })),
        },
      });
      setDraftNotice(
        `Order draft ${result?.draftId ?? "created"} is ready for the customer to review.`,
      );
      setDraftItems([]);
      setResults([]);
    } catch {
      setDraftNotice(
        "Could not create the assisted order draft. Check product availability and merchant consistency.",
      );
    } finally {
      setDraftBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-black">Support Inbox</h1>
        <p className="mt-1 text-sm text-market-muted">
          Customer support conversations. Merchant contact remains internal.
        </p>
      </div>
      <div className="grid min-h-[650px] overflow-hidden rounded-3xl border border-market-line bg-white shadow-market lg:grid-cols-[320px_1fr]">
        <aside className="border-r border-market-line">
          <div className="p-3">
            <a href="/admin/orders" className="font-bold text-market-green">
              Order intelligence
            </a>
            <label className="mt-2 block text-sm">
              Inbox status
              <select
                value={inboxStatus}
                onChange={(e) => void loadInbox(0, e.target.value as typeof inboxStatus)}
                className="ml-2 rounded border p-2"
              >
                {["active", "all", "closed", "resolved"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {inboxError && (
              <p role="alert">
                Inbox unavailable. <button onClick={() => void loadInbox(inboxPage)}>Retry</button>
              </p>
            )}
          </div>
          {inbox.slice(0, 20).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={`block w-full border-b border-market-line p-4 text-left ${selected === c.id ? "bg-market-soft" : ""}`}
            >
              <div className="flex justify-between gap-2">
                <b className="truncate text-sm">
                  {c.orderId ? `Order ${c.orderId}` : "General support"}
                </b>
                <span className="text-[10px] text-market-muted">
                  {c.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-market-muted">
                {c.lastMessage || "No messages yet"}
              </p>
            </button>
          ))}
          <div className="p-3">
            <Pagination
              page={inboxPage}
              hasMore={inbox.length > 20}
              onPage={(p) => void loadInbox(p)}
            />
          </div>
        </aside>
        <section className="flex min-h-[650px] flex-col">
          <div className="p-4">
            {selected && (
              <AdminSupportThread
                key={selected}
                conversationId={selected}
                orderId={inbox.find((c) => c.id === selected)?.orderId ?? null}
              />
            )}
          </div>
          <div className="border-t border-market-line p-3">
            <div className="mb-3 rounded-2xl border border-market-line bg-market-soft p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black">Agent-assisted order</p>
                  <p className="text-[10px] text-market-muted">
                    Prepare an order for this customer. Customer approval and payment are still
                    required.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void createDraft()}
                  disabled={draftBusy || !draftItems.length || !selected}
                  className="rounded-lg bg-market-green px-3 py-2 text-[10px] font-black text-white disabled:opacity-40"
                >
                  {draftBusy ? "Preparing…" : "Send order for review"}
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void findProducts();
                    }
                  }}
                  placeholder="Search product…"
                  className="min-w-0 flex-1 rounded-lg border border-market-line bg-white px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void findProducts()}
                  className="rounded-lg border border-market-line bg-white px-3 text-xs font-black"
                >
                  Search
                </button>
              </div>
              {results.length > 0 && (
                <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-market-line bg-white">
                  {results.map((p) => (
                    <div key={p.id} className="border-b border-market-line px-3 py-2 last:border-0">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span>
                          <b>{p.name}</b>
                          <span className="block text-[10px] text-market-muted">
                            {p.merchantName} · GHS {p.price} · stock {p.stock}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => addDraftItem(p)}
                          className="font-black text-market-green"
                        >
                          Add
                        </button>
                      </div>
                      {Array.isArray(p.variants) && p.variants.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {p.variants.map((v: any) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => addDraftItem(p, v)}
                              className="flex w-full justify-between rounded-md bg-market-soft px-2 py-1 text-left text-[10px]"
                            >
                              <span>{v.name}</span>
                              <span className="font-black text-market-green">
                                GHS {v.price} · Add
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {draftItems.length > 0 && (
                <div className="mt-2 space-y-1">
                  {draftItems.map((i) => (
                    <div
                      key={`${i.productId}:${i.variantId}`}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-[10px]"
                    >
                      <span className="truncate">
                        {i.name} × {i.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDraftItems(draftItems.filter((x) => x !== i))}
                        className="font-black text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {draftNotice && (
                <p role="status" className="mt-2 text-[10px] font-semibold text-market-muted">
                  {draftNotice}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
