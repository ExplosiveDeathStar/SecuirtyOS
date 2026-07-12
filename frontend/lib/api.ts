/**
 * Thin API client + polling hook. All requests go through the Next.js proxy
 * to the local backend — the browser never leaves localhost.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera, DashboardData, Person, SecurityEvent, SubscriptionPlan, TestResult, User } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  auth: {
    me: () => request<{ user: User | null }>("/api/auth/me"),
    signup: (input: { email: string; password: string; plan: SubscriptionPlan }) =>
      request<{ user: User }>("/api/auth/signup", { method: "POST", body: JSON.stringify(input) }),
    login: (input: { email: string; password: string }) =>
      request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  },
  billing: {
    status: () => request<{ configured: boolean; user: User }>("/api/billing/status"),
    checkout: (plan: SubscriptionPlan) =>
      request<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan }),
      }),
    portal: () => request<{ url: string }>("/api/billing/portal", { method: "POST" }),
  },
  dashboard: () => request<DashboardData>("/api/dashboard"),
  cameras: {
    list: () => request<Camera[]>("/api/cameras"),
    create: (input: Partial<Camera> & { password?: string }) =>
      request<Camera>("/api/cameras", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<Camera> & { password?: string }) =>
      request<Camera>(`/api/cameras/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<void>(`/api/cameras/${id}`, { method: "DELETE" }),
    test: (input: { rtspUrl: string; username?: string; password?: string }) =>
      request<TestResult>("/api/cameras/test", { method: "POST", body: JSON.stringify(input) }),
    testSaved: (id: string) => request<TestResult>(`/api/cameras/${id}/test`, { method: "POST" }),
    suggestLocation: (id: string) =>
      request<{ location: string | null; message: string }>(`/api/cameras/${id}/suggest-location`, {
        method: "POST",
      }),
    previewUrl: (id: string) => `/api/cameras/${id}/preview`,
  },
  events: {
    list: (params: Record<string, string> = {}) =>
      request<SecurityEvent[]>(`/api/events?${new URLSearchParams(params)}`),
  },
  persons: {
    list: () => request<Person[]>("/api/persons"),
    update: (id: string, input: { name?: string; safe?: boolean; faceUrl?: string }) =>
      request<Person>(`/api/persons/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    merge: (targetId: string, sourceId: string) =>
      request<Person>(`/api/persons/${targetId}/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceId }),
      }),
    delete: (id: string) => request<void>(`/api/persons/${id}`, { method: "DELETE" }),
  },
};

/** Fetch on mount and re-fetch on an interval — keeps dashboards live without websockets. */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
