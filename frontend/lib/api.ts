/**
 * Thin API client + polling hook. All requests go through the Next.js proxy
 * to the local backend — the browser never leaves localhost.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Camera, DashboardData, SecurityEvent, TestResult } from "./types";

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
    previewUrl: (id: string) => `/api/cameras/${id}/preview`,
  },
  events: {
    list: (params: Record<string, string> = {}) =>
      request<SecurityEvent[]>(`/api/events?${new URLSearchParams(params)}`),
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
