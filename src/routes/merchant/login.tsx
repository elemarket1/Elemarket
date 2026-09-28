import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { getMerchantLoginContext } from "@/lib/auth/merchant-context.functions";

export const Route = createFileRoute("/merchant/login")({ component: MerchantLogin });

const messages = {
  not_found: "No active merchant account was found for this login.",
  pending: "Your merchant application is still under review.",
  rejected: "Your merchant application was not approved. Please contact ELEMARKET support if you need to address the decision.",
  not_activated: "Your merchant application is approved, but merchant access has not been activated yet.",
  suspended: "Merchant access for this account is suspended or revoked.",
  admin_only: "Administrator accounts use the separate admin sign-in.",
} as const;

function MerchantLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!authEnabled) throw new Error("Merchant sign-in requires authentication to be enabled");
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
        callbackURL: "/merchant/dashboard",
      });
      if (result.error) throw new Error(result.error.message ?? "Invalid merchant credentials");

      const context = await getMerchantLoginContext();
      if (!context.authorized) {
        await authClient.signOut();
        throw new Error(messages[context.reason]);
      }

      window.location.assign("/merchant/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merchant sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-market-bg px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-market-line bg-white p-7 shadow-market sm:p-9">
        <Link to="/" className="text-2xl font-black tracking-[-0.04em] text-market-green">
          ELE<span className="text-market-orange">MARKET</span>
        </Link>
        <p className="mt-6 text-xs font-black uppercase tracking-[.16em] text-market-muted">Merchant portal</p>
        <h1 className="mt-2 text-3xl font-black">Merchant sign in</h1>
        <p className="mt-2 text-sm leading-6 text-market-muted">
          This is separate from customer sign-in. Use this entry point to open your merchant workspace.
        </p>

        {authEnabled ? (
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <label className="block text-sm font-bold">
              Merchant email
              <input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3 font-medium outline-none focus:border-market-green" />
            </label>
            <label className="block text-sm font-bold">
              Password
              <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3 font-medium outline-none focus:border-market-green" />
            </label>
            {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
            <button disabled={busy} className="h-12 w-full rounded-xl bg-market-green text-sm font-black text-white disabled:opacity-50">
              {busy ? "Authenticating…" : "Sign in to merchant portal"}
            </button>
            <Link to="/reset-password" className="block text-center text-sm font-bold text-market-green">Forgot password?</Link>
          </form>
        ) : (
          <p className="mt-6 rounded-xl bg-market-soft p-4 text-sm text-market-muted">Merchant sign-in is disabled in this environment.</p>
        )}

        <div className="mt-7 space-y-2 border-t border-market-line pt-5 text-center text-sm">
          <Link to="/login" className="block font-bold text-market-green">Customer sign in</Link>
        </div>
      </section>
    </main>
  );
}
