import { label } from "@/lib/admin/format";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readAdminSupportConversation,
  manageAdminSupport,
  listAdminSupportStaff,
} from "@/lib/admin/support-operations.functions";
import {
  supportCategories,
  supportStatuses,
  type SupportActionInput,
} from "@/lib/admin/orders.schemas";
import { Fields, LoadError, Pagination } from "./admin-order-ui";
export function AdminSupportThread({
  conversationId,
  orderId,
}: {
  conversationId: string;
  orderId: string | null;
}) {
  const [page, setPage] = useState(0),
    [body, setBody] = useState(""),
    [kind, setKind] = useState<"reply" | "note">("reply"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [staffPage, setStaffPage] = useState(0),
    [assignee, setAssignee] = useState(""),
    [status, setStatus] = useState<(typeof supportStatuses)[number]>("open"),
    [category, setCategory] = useState<(typeof supportCategories)[number]>("general"),
    [subject, setSubject] = useState(""),
    [linkOrder, setLinkOrder] = useState("");
  const pending = useRef<{ payload: string; key: string } | null>(null);
  const client = useQueryClient();
  const thread = useQuery({
    queryKey: ["admin-support-thread", conversationId, orderId, page],
    queryFn: () =>
      readAdminSupportConversation({ data: { conversationId, orderId, page, pageSize: 20 } }),
    retry: false,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const staff = useQuery({
    queryKey: ["admin-support-staff", staffPage],
    queryFn: () => listAdminSupportStaff({ data: { page: staffPage, pageSize: 20 } }),
    retry: false,
  });
  async function act(
    values: Omit<SupportActionInput, "conversationId" | "orderId" | "idempotencyKey"> &
      Record<string, unknown>,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    const payload = JSON.stringify(values);
    if (pending.current?.payload !== payload)
      pending.current = { payload, key: crypto.randomUUID() };
    try {
      await manageAdminSupport({
        data: {
          ...values,
          conversationId,
          orderId: values.action === "link" ? linkOrder : orderId,
          idempotencyKey: pending.current.key,
        } as SupportActionInput,
      });
      pending.current = null;
      if (values.action === "reply" || values.action === "note") setBody("");
      await client.invalidateQueries({ queryKey: ["admin-support-thread"] });
      await client.invalidateQueries({ queryKey: ["admin-order-section"] });
      if (values.action === "link")
        window.location.assign(`/admin/orders/${encodeURIComponent(linkOrder)}`);
    } catch {
      setError(
        "Action could not be completed. Check the conversation status, order binding and recent MFA session. Retry uses the same operation key.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (thread.isPending) return <p role="status">Loading conversation…</p>;
  if (thread.isError) return <LoadError retry={() => void thread.refetch()} />;
  return (
    <section className="space-y-5 rounded-2xl border border-market-line bg-white p-5">
      <div>
        <h3 className="text-xl font-black">{String(thread.data.conversation.subject)}</h3>
        <p className="mt-1 text-sm text-market-muted">
          Customer ↔ ELEMARKET support. Merchant messaging and attachments are not supported by this
          conversation system.
        </p>
      </div>
      <Fields
        row={thread.data.conversation}
        keys={[
          "id",
          "orderId",
          "customer",
          "customerId",
          "category",
          "status",
          "assignedTo",
          "assignee",
          "createdAt",
          "updatedAt",
          "escalatedAt",
          "resolvedAt",
        ]}
      />
      {orderId && (
        <a
          className="inline-block text-sm font-bold text-market-green"
          href={`/admin/orders/${encodeURIComponent(orderId)}`}
        >
          Open linked order
        </a>
      )}
      <div className="space-y-3" aria-label="Conversation messages">
        {thread.data.messages.length === 0 ? (
          <p>No messages yet.</p>
        ) : (
          thread.data.messages.map((m) => (
            <article
              key={String(m.id)}
              className={`rounded-xl border p-4 ${m.kind === "internal_note" ? "border-amber-300 bg-amber-50" : "border-market-line bg-market-soft"}`}
            >
              <p className="text-xs font-bold">
                {m.kind === "internal_note"
                  ? "Internal staff note — never shared with customer"
                  : label(String(m.senderType))}{" "}
                · {String(m.createdAt)}
              </p>
              <p className="mt-1 text-xs text-market-muted">{String(m.senderId)}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{String(m.body)}</p>
            </article>
          ))
        )}
      </div>
      <Pagination page={page} hasMore={thread.data.hasMore} onPage={setPage} />
      <div className="space-y-2">
        <label className="block text-sm font-bold">
          Message visibility
          <select
            aria-label="Message visibility"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="ml-3 rounded border p-2"
          >
            <option value="reply">Customer-visible reply</option>
            <option value="note">Internal staff note</option>
          </select>
        </label>
        <textarea
          aria-label="Support message"
          data-testid="admin-support-message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={3}
          className="w-full rounded-xl border p-3"
          placeholder={
            kind === "note" ? "Only authorized staff can read this note." : "Reply to the customer…"
          }
        />
        <button
          type="button"
          data-testid="admin-support-submit"
          disabled={busy || !body.trim()}
          onClick={() => void act({ action: kind, body: body.trim() })}
          className="rounded-lg bg-market-green px-4 py-2 font-bold text-white disabled:opacity-40"
        >
          {kind === "note" ? "Add internal note" : "Send reply"}
        </button>
      </div>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-bold">Manage conversation</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-bold">
              Assign support staff
              <select
                aria-label="Assign support staff"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="mt-1 w-full rounded border p-2"
              >
                <option value="">Unassigned</option>
                {staff.data?.rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() => void act({ action: "assign", assigneeId: assignee || null })}
              className="mt-2 rounded border px-3 py-2"
            >
              Assign
            </button>
            {staff.isError ? (
              <p role="alert">Staff list unavailable.</p>
            ) : (
              <Pagination
                page={staffPage}
                hasMore={staff.data?.hasMore ?? false}
                onPage={setStaffPage}
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-bold">
              Support status
              <select
                aria-label="Support status"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="mt-1 w-full rounded border p-2"
              >
                {supportStatuses.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy}
              className="mt-2 rounded border px-3 py-2"
              onClick={() => {
                if (
                  !["closed", "resolved"].includes(status) ||
                  window.confirm(
                    "Close or resolve this support conversation? The order and payment state will not change.",
                  )
                )
                  void act({ action: "status", status });
              }}
            >
              Update status / reopen
            </button>
            <button
              disabled={busy}
              onClick={() => void act({ action: "escalate" })}
              className="ml-2 rounded border px-3 py-2"
            >
              Escalate
            </button>
          </div>
          <div>
            <label className="block text-sm">
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={160}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            <label className="block text-sm">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className="mt-1 w-full rounded border p-2"
              >
                {supportCategories.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !subject.trim()}
              onClick={() => void act({ action: "classify", subject: subject.trim(), category })}
              className="mt-2 rounded border px-3 py-2"
            >
              Save classification
            </button>
          </div>
          {!orderId && (
            <div>
              <label className="block text-sm">
                Link customer’s order
                <input
                  value={linkOrder}
                  onChange={(e) => setLinkOrder(e.target.value)}
                  maxLength={128}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <button
                disabled={busy || !linkOrder}
                onClick={() => {
                  if (window.confirm("Permanently link this conversation to the customer’s order?"))
                    void act({ action: "link" });
                }}
                className="mt-2 rounded border px-3 py-2"
              >
                Attach order context
              </button>
            </div>
          )}
        </div>
      </details>
      {busy && <p role="status">Saving…</p>}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
