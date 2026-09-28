import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { requestEmailOtpCode, requestOtpCode, verifyEmailOtpCode } from "@/lib/auth/otp";
import { createMerchantApplication, getCustomerProfile, getMerchantRegistrationContext, saveSignupProfile, markPhoneVerified } from "@/lib/auth/account.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { CATEGORIES } from "@/lib/market/categories";

export const Route = createFileRoute("/merchant/register")({ component: MerchantRegister });

type Stage = "form" | "email" | "phone" | "done";

function MerchantRegister() {
  const { user, isPending } = useCurrentUserState();
  const existingCustomer = Boolean(user && !user.isDevFallback);
  const signedIn = existingCustomer;
  const [stage, setStage] = useState<Stage>("form");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("electronics");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [taxpayerIdType, setTaxpayerIdType] = useState<"tin" | "ghana_card_pin" | "other">("tin");
  const [taxpayerId, setTaxpayerId] = useState("");
  const [businessType, setBusinessType] = useState<"sole_proprietorship" | "partnership" | "limited_company" | "cooperative" | "other">("sole_proprietorship");
  const [taxRegistrationStatus, setTaxRegistrationStatus] = useState<"registered" | "pending" | "not_registered" | "not_applicable">("registered");
  const [vatRegistrationStatus, setVatRegistrationStatus] = useState<"registered" | "pending" | "not_registered" | "not_applicable" | "">("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [emailChallengeId, setEmailChallengeId] = useState<string | null>(null);
  const [phoneChallengeId, setPhoneChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn || !user) return;
    // Prefill only empty fields. These requests are asynchronous, so they can
    // resolve after the customer has already started typing. Never let a late
    // profile/context response overwrite user-entered form state.
    setName((current) => current || user.displayName || "");
    setEmail((current) => current || user.primaryEmail || "");

    void getMerchantRegistrationContext().then((context) => {
      if (!context.signedIn) return;
      setName((current) => current || context.name || user.displayName || "");
      setEmail((current) => current || context.email || user.primaryEmail || "");
      setPhone((current) => current || context.phone || "");
    }).catch(() => undefined);

    void getCustomerProfile().then((profile) => {
      setName((current) => current || profile.name || user.displayName || "");
      setPhone((current) => current || profile.phone || "");
      setAddress((current) => current || profile.address || "");
    }).catch(() => undefined);
  }, [signedIn, user]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!authEnabled) throw new Error("Merchant registration requires authentication to be enabled");

      const applicationData = {
        businessName: businessName.trim(),
        category,
        address: address.trim(),
        contact: phone.trim(),
        registrationNumber: registrationNumber.trim(),
        taxpayerIdType,
        taxpayerId: taxpayerId.trim(),
        businessType,
        taxRegistrationStatus,
        vatRegistrationStatus: vatRegistrationStatus || null,
      };

      if (signedIn) {
        await saveSignupProfile({ data: { name: name.trim(), phone: phone.trim() } });
        await createMerchantApplication({ data: applicationData });
        const otp = await requestOtpCode({ data: { number: phone.trim(), purpose: "phone_verification" } });
        setPhoneChallengeId(otp.challengeId);
        setStage("phone");
        return;
      }

      if (!password) throw new Error("Password is required for a new merchant account");
      const result = await authClient.signUp.email({
        email: email.trim(), password, name: name.trim(), callbackURL: "/merchant/register",
      });
      if (result.error) throw new Error(result.error.message ?? "Could not create account");
      const otp = await requestEmailOtpCode({ data: { email: email.trim(), purpose: "signup" } });
      setEmailChallengeId(otp.challengeId);
      setStage("email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail() {
    if (!emailChallengeId) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailOtpCode({ data: { challengeId: emailChallengeId, code: emailCode, purpose: "signup" } });
      const signed = await authClient.signIn.email({ email: email.trim(), password, callbackURL: "/merchant/register" });
      if (signed.error) throw new Error(signed.error.message ?? "Email verified, but sign-in failed");
      await saveSignupProfile({ data: { name: name.trim(), phone: phone.trim() } });
      await createMerchantApplication({
        data: {
          businessName: businessName.trim(), category, address: address.trim(), contact: phone.trim(), registrationNumber: registrationNumber.trim(),
          taxpayerIdType, taxpayerId: taxpayerId.trim(), businessType, taxRegistrationStatus,
          vatRegistrationStatus: vatRegistrationStatus || null,
        },
      });
      const otp = await requestOtpCode({ data: { number: phone.trim(), purpose: "phone_verification" } });
      setPhoneChallengeId(otp.challengeId);
      setStage("phone");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyPhone() {
    if (!phoneChallengeId) return;
    setBusy(true);
    setError(null);
    try {
      await markPhoneVerified({ data: { challengeId: phoneChallengeId, code: phoneCode } });
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Phone verification failed");
    } finally {
      setBusy(false);
    }
  }

  if (!authEnabled) return <main className="grid min-h-screen place-items-center bg-market-bg px-4"><section className="w-full max-w-md rounded-3xl border border-market-line bg-white p-7 shadow-market"><h1 className="text-2xl font-black">Merchant registration unavailable</h1><p className="mt-2 text-sm text-market-muted">Authentication must be enabled before merchant onboarding can be used.</p></section></main>;
  if (isPending) return <main className="grid min-h-screen place-items-center bg-market-bg px-4"><p className="text-sm font-semibold text-market-muted">Loading your account…</p></main>;

  return <main className="min-h-screen bg-market-bg px-4 py-10">
    <section className="mx-auto w-full max-w-2xl rounded-3xl border border-market-line bg-white p-7 shadow-market sm:p-9">
      <Link to="/" className="text-2xl font-black tracking-[-0.04em] text-market-green">ELE<span className="text-market-orange">MARKET</span></Link>
      {stage === "form" && <>
        <h1 className="mt-6 text-3xl font-black">Become a merchant</h1>
        <p className="mt-2 text-sm leading-6 text-market-muted">{existingCustomer ? "Use your existing ELEMARKET account. You do not need to create another customer account." : "Create your ELEMARKET account and submit your business for verification."}</p>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <section className="rounded-2xl border border-market-line p-4 sm:p-5">
            <h2 className="text-lg font-black">Account & business identity</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold">Your name<input required value={name} onChange={e=>setName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3" autoComplete="name" /></label>
              <label className="text-sm font-bold">Email<input required type="email" value={email} readOnly={existingCustomer} onChange={e=>setEmail(e.target.value)} className={`mt-1 h-11 w-full rounded-xl border border-market-line px-3 ${existingCustomer ? "bg-market-soft text-market-muted" : ""}`} autoComplete="email" /></label>
              {!existingCustomer && <label className="text-sm font-bold sm:col-span-2">Password<input required type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3" autoComplete="new-password" /></label>}
              <label className="text-sm font-bold sm:col-span-2">Legal/business name<input required value={businessName} onChange={e=>setBusinessName(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3" /></label>
              <label className="text-sm font-bold">Business registration number <span className="text-red-600">*</span><input required minLength={2} value={registrationNumber} onChange={e=>setRegistrationNumber(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3" autoComplete="off" /></label>
              <label className="text-sm font-bold">Business type<select required value={businessType} onChange={e=>setBusinessType(e.target.value as typeof businessType)} className="mt-1 h-11 w-full rounded-xl border border-market-line bg-white px-3"><option value="sole_proprietorship">Sole proprietorship</option><option value="partnership">Partnership</option><option value="limited_company">Limited company</option><option value="cooperative">Cooperative</option><option value="other">Other</option></select></label>
              <label className="text-sm font-bold">Business category<select required value={category} onChange={e=>setCategory(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line bg-white px-3">{CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
            </div>
          </section>

          <section className="rounded-2xl border border-market-line p-4 sm:p-5">
            <h2 className="text-lg font-black">Tax information</h2>
            <p className="mt-1 text-xs text-market-muted">Provide the taxpayer identification used for the business. VAT status is optional at onboarding.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold">Taxpayer ID type<select required value={taxpayerIdType} onChange={e=>setTaxpayerIdType(e.target.value as typeof taxpayerIdType)} className="mt-1 h-11 w-full rounded-xl border border-market-line bg-white px-3"><option value="tin">TIN</option><option value="ghana_card_pin">Ghana Card PIN</option><option value="other">Other taxpayer ID</option></select></label>
              <label className="text-sm font-bold">Taxpayer ID<input required value={taxpayerId} onChange={e=>setTaxpayerId(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3" autoComplete="off" /></label>
              <label className="text-sm font-bold">Tax registration status<select required value={taxRegistrationStatus} onChange={e=>setTaxRegistrationStatus(e.target.value as typeof taxRegistrationStatus)} className="mt-1 h-11 w-full rounded-xl border border-market-line bg-white px-3"><option value="registered">Registered</option><option value="pending">Pending</option><option value="not_registered">Not registered</option><option value="not_applicable">Not applicable</option></select></label>
              <label className="text-sm font-bold">VAT registration status <span className="font-normal text-market-muted">(optional)</span><select value={vatRegistrationStatus} onChange={e=>setVatRegistrationStatus(e.target.value as typeof vatRegistrationStatus)} className="mt-1 h-11 w-full rounded-xl border border-market-line bg-white px-3"><option value="">Not provided</option><option value="registered">Registered</option><option value="pending">Pending</option><option value="not_registered">Not registered</option><option value="not_applicable">Not applicable</option></select></label>
            </div>
          </section>

          <section className="rounded-2xl border border-market-line p-4 sm:p-5">
            <h2 className="text-lg font-black">Business contact & address</h2>
            <div className="mt-4 grid gap-4">
              <label className="text-sm font-bold">Business address<textarea required minLength={8} value={address} onChange={e=>setAddress(e.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-market-line px-3 py-2" /></label>
              <label className="text-sm font-bold">Business phone<input required type="tel" placeholder="05XXXXXXXX or +2335XXXXXXXX" value={phone} onChange={e=>setPhone(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-market-line px-3" autoComplete="tel" /></label>
            </div>
          </section>



          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
          <button disabled={busy} className="h-12 w-full rounded-xl bg-market-green text-sm font-black text-white disabled:opacity-50">{busy ? "Submitting…" : existingCustomer ? "Submit merchant application" : "Create merchant account"}</button>
        </form>
        <Link to="/login" className="mt-4 block text-center text-sm font-bold text-market-green">Already have an account? Sign in</Link>
      </>}
      {stage === "email" && <Verification title="Verify your email" description={`Enter the 6-digit code sent to ${email}.`} value={emailCode} setValue={setEmailCode} onVerify={verifyEmail} busy={busy} error={error} />}
      {stage === "phone" && <Verification title="Verify your phone" description={`Enter the 6-digit code sent to ${phone}.`} value={phoneCode} setValue={setPhoneCode} onVerify={verifyPhone} busy={busy} error={error} />}
      {stage === "done" && <div className="mt-7 rounded-2xl border border-market-line bg-market-soft p-6"><h1 className="text-2xl font-black">Application submitted</h1><p className="mt-2 text-sm leading-6 text-market-muted">Your email and phone are verified. Your merchant information is now in the ELEMARKET review queue.</p><Link to="/" className="mt-5 inline-flex h-11 items-center rounded-xl bg-market-green px-5 text-sm font-black text-white">Return to marketplace</Link></div>}
    </section>
  </main>;
}

function Verification({ title, description, value, setValue, onVerify, busy, error }: { title:string; description:string; value:string; setValue:(v:string)=>void; onVerify:()=>void; busy:boolean; error:string|null }) {
  return <div className="mt-7 rounded-2xl border border-market-line bg-market-soft p-5"><h1 className="text-2xl font-black">{title}</h1><p className="mt-2 text-sm text-market-muted">{description}</p><input value={value} onChange={e=>setValue(e.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="mt-5 h-14 w-full rounded-xl border border-market-line bg-white text-center text-2xl font-black tracking-[.35em]" />{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<button type="button" disabled={busy || value.length!==6} onClick={onVerify} className="mt-4 h-12 w-full rounded-xl bg-market-orange text-sm font-black text-white disabled:opacity-50">{busy ? "Verifying…" : "Verify"}</button></div>;
}
