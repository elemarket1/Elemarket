import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/client";

/** Per-session, in-memory query state; never a cross-request SSR singleton. */
export function AdminDataBoundary({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  if (isPending)
    return (
      <p role="status" className="p-8">
        Checking administrator session…
      </p>
    );
  return <SessionQueries key={data?.session.id ?? "anonymous"}>{children}</SessionQueries>;
}
function SessionQueries({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
        },
      }),
  );
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
