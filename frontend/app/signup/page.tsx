"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SubscriptionPlan, User } from "@/lib/types";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState<SubscriptionPlan>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingUser, setExistingUser] = useState<User | null>(null);

  useEffect(() => {
    void api.auth.me().then(({ user }) => {
      if (user && user.role !== "owner" && user.billingStatus !== "active") {
        setExistingUser(user);
        setEmail(user.email);
        setPlan(user.plan);
      }
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = existingUser ?? (await api.auth.signup({ email, password, plan })).user;
      if (user.role === "owner") {
        router.replace("/");
        return;
      }
      const checkout = await api.billing.checkout(plan);
      window.location.assign(checkout.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-accent/40">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-accent">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-12.286A11.96 11.96 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286z" />
            </svg>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Start with SecurityOS</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Add an AI intelligence layer to the cameras users already own.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_0.9fr]">
          <section className="grid gap-4">
            <PlanCard
              selected={plan === "monthly"}
              title="Monthly"
              price="$10"
              cadence="/ month"
              description="Best for trying the product with one camera setup."
              onClick={() => setPlan("monthly")}
            />
            <PlanCard
              selected={plan === "yearly"}
              title="Yearly"
              price="$100"
              cadence="/ year"
              description="Two months free for users ready to run it full-time."
              badge="Best value"
              onClick={() => setPlan("yearly")}
            />
            <div className="rounded-xl border border-edge bg-panel px-5 py-4 text-xs leading-5 text-zinc-500">
              Secure payment is handled by Stripe Checkout. SecurityOS does not store card numbers.
              Access activates after Stripe confirms payment.
            </div>
          </section>

          <form onSubmit={submit} className="rounded-2xl border border-edge bg-panel p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Create your account</h2>
            <div className="mt-5 grid gap-4">
              {existingUser ? (
                <div className="rounded-lg border border-edge bg-panel-2 px-3 py-3 text-xs text-zinc-400">
                  Continue payment for <span className="font-medium text-zinc-200">{existingUser.email}</span>
                </div>
              ) : (
                <>
                  <Field label="Email">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      required
                      placeholder="At least 8 characters"
                      className={inputCls}
                    />
                  </Field>
                </>
              )}
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Opening secure checkout..." : `Continue with ${plan === "yearly" ? "$100/year" : "$10/month"}`}
              </button>
              <p className="text-center text-xs text-zinc-500">
                Already have an account? <Link href="/login" className="text-accent hover:brightness-110">Log in</Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function PlanCard({
  selected,
  title,
  price,
  cadence,
  description,
  badge,
  onClick,
}: {
  selected: boolean;
  title: string;
  price: string;
  cadence: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-5 text-left transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-edge bg-panel hover:border-accent/50"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        {badge && <span className="rounded-md bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent">{badge}</span>}
      </div>
      <div className="mt-3 flex items-end gap-1">
        <span className="text-3xl font-semibold">{price}</span>
        <span className="pb-1 text-sm text-zinc-500">{cadence}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{description}</p>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-edge bg-panel-2 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none";
