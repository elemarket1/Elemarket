import type { SafeRow } from "@/lib/admin/orders.schemas";
import { label, display } from "@/lib/admin/format";
export function Fields({ row, keys }: { row: SafeRow; keys: string[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {keys.map((key) => (
        <div key={key}>
          <dt className="text-xs font-bold uppercase tracking-wide text-market-muted">
            {label(key)}
          </dt>
          <dd className="mt-1 break-words text-sm">{display(row[key])}</dd>
        </div>
      ))}
    </dl>
  );
}
export function DataTable({ rows, onOpen }: { rows: SafeRow[]; onOpen?: (row: SafeRow) => void }) {
  if (!rows.length)
    return (
      <p className="rounded-xl bg-market-soft p-5 text-sm text-market-muted">
        No records in this section.
      </p>
    );
  const keys = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-xl border border-market-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-market-soft">
          <tr>
            {keys.map((k) => (
              <th key={k} className="whitespace-nowrap p-3 text-xs font-bold">
                {label(k)}
              </th>
            ))}
            {onOpen && <th className="p-3">Open</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? r.event_key ?? i)} className="border-t border-market-line">
              {keys.map((k) => (
                <td key={k} className="max-w-xs break-words p-3 align-top">
                  {display(r[k])}
                </td>
              ))}
              {onOpen && (
                <td className="p-3">
                  <button className="font-bold text-market-green" onClick={() => onOpen(r)}>
                    Open
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (p: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-4">
      <button
        disabled={!page}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border px-3 py-2 disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-sm">Page {page + 1}</span>
      <button
        disabled={!hasMore}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border px-3 py-2 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
export function LoadError({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl bg-red-50 p-5 text-red-800">
      <p>
        Unable to load this information. Check your administrator access and verified MFA session.
      </p>
      <div className="mt-3 flex gap-4">
        <button className="font-bold underline" onClick={retry}>
          Retry
        </button>
        <a href="/admin" className="underline">
          Administrator sign in
        </a>
      </div>
    </div>
  );
}
