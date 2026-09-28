import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

export const Route = createFileRoute("/two-factor")({ component: TwoFactor });

function TwoFactor() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true); setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    if (result.error) {
      setError(result.error.message ?? "Verification failed");
    } else {
      const callback = sessionStorage.getItem("elemarket.admin.post2faCallback");
      sessionStorage.removeItem("elemarket.admin.post2faCallback");
      window.location.assign(callback === "/admin/dashboard" ? callback : "/");
      return;
    }
    setBusy(false);
  }
  return <main className="grid min-h-screen place-items-center bg-market-bg px-4 py-10"><section className="w-full max-w-md rounded-3xl border border-market-line bg-white p-7 shadow-market"><p className="text-xs font-black uppercase tracking-[.16em] text-market-muted">Security verification</p><h1 className="mt-3 text-2xl font-black">Enter your authenticator code</h1><p className="mt-2 text-sm text-market-muted">Use the current 6-digit code from your authenticator app. This device will not be remembered.</p><input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g, "").slice(0,6))} className="mt-6 h-14 w-full rounded-xl border border-market-line px-3 text-center text-2xl font-black tracking-[.35em]" placeholder="000000"/><button disabled={busy||code.length!==6} onClick={()=>void verify()} className="mt-4 h-12 w-full rounded-xl bg-black text-sm font-black text-white disabled:opacity-50">{busy?"Verifying…":"Verify and continue"}</button>{error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<Link to="/" className="mt-5 inline-flex text-sm font-bold text-market-green">Return to marketplace</Link></section></main>;
}
