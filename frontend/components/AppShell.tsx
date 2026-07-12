"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { Sidebar } from "./Sidebar";

const PUBLIC_PATHS = new Set(["/login", "/signup"]);

/** Auth-aware app frame. Public pages show without nav; app pages require login. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicPage = PUBLIC_PATHS.has(pathname);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api.auth.me().then(({ user }) => {
      if (cancelled) return;
      setUser(user);
      if (!user && !publicPage) router.replace("/login");
      const paid = user?.role === "owner" || user?.billingStatus === "active";
      if (user && publicPage && paid) router.replace("/");
      if (user && !publicPage && !paid) router.replace("/signup");
    }).catch(() => {
      if (!cancelled) {
        setUser(null);
        if (!publicPage) router.replace("/login");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [publicPage, router]);

  if (publicPage) return <>{children}</>;

  if (user === undefined || user === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
        Loading SecurityOS...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} />
      <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
    </div>
  );
}
