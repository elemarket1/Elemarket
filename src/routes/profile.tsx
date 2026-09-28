import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { getCustomerProfile, updateCustomerProfile } from "@/lib/auth/account.functions";
import { getAdminAccessState } from "./admin/access.functions";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/profile")({
  loader: async () => {
    const access = await getAdminAccessState();
    if (!access.authenticated) throw redirect({ to: "/login" });
    return getCustomerProfile();
  },
  component: Profile,
});

function Profile() {
  const profile = Route.useLoaderData();
  const [name, setName] = useState(profile.name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [address, setAddress] = useState(profile.address ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await updateCustomerProfile({ data: { name, phone, address } });
      setMessage("Profile updated successfully.");
    } catch (err) {
      setError("Could not update your profile. Please check the details and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-market-bg px-4 py-10">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-market-line bg-white p-7 shadow-market sm:p-9">
        <a href="/" className="text-2xl font-black tracking-[-0.04em] text-market-green">
          ELE<span className="text-market-orange">MARKET</span>
        </a>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black">My profile</h1>
            <p className="mt-2 text-sm text-market-muted">
              Update your contact and delivery details.
            </p>
          </div>
          <Link
            to="/orders"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-market-soft px-4 text-sm font-bold text-market-green"
          >
            My orders
          </Link>
        </div>
        <form className="mt-7 space-y-4" onSubmit={save}>
          <label className="block text-sm font-bold">
            Email
            <input
              readOnly
              value={profile.email}
              className="mt-1 h-11 w-full rounded-xl border border-market-line bg-market-soft px-3 text-market-muted"
            />
          </label>
          <label className="block text-sm font-bold">
            Name
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-market-line px-3"
            />
          </label>
          <label className="block text-sm font-bold">
            Phone
            <input
              type="tel"
              placeholder="05XXXXXXXX or +2335XXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-market-line px-3"
            />
          </label>
          <label className="block text-sm font-bold">
            Delivery address
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 min-h-24 w-full rounded-xl border border-market-line px-3 py-2"
            />
          </label>
          {message && (
            <p className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-700">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="h-12 w-full rounded-xl bg-market-green text-sm font-black text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>
    </main>
  );
}
