"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login({ email, password });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Log in to SecurityOS"
      subtitle="AI identity, sightings, and camera intelligence for your existing security setup."
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Logging in..." : "Log in"}
        </button>
        <p className="text-center text-xs text-zinc-500">
          New here? <Link href="/signup" className="text-accent hover:brightness-110">Create an account</Link>
        </p>
      </form>
    </AuthFrame>
  );
}

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="grid w-full max-w-5xl gap-8 md:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-center">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 ring-1 ring-accent/40">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-accent">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-12.286A11.96 11.96 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286z" />
            </svg>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">SecurityOS</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{subtitle}</p>
          <div className="mt-8 grid gap-3 text-sm text-zinc-400">
            <Feature>Local-first video processing</Feature>
            <Feature>Person identity, merge, and sighting history</Feature>
            <Feature>Works with RTSP and bridge-based camera setups</Feature>
          </div>
        </section>
        <section className="rounded-2xl border border-edge bg-panel p-6 shadow-2xl">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </main>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {children}
    </div>
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
