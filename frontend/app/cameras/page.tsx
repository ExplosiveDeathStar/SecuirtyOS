"use client";

import { useState } from "react";
import { CameraForm } from "@/components/CameraForm";
import { StatusBadge } from "@/components/StatusBadge";
import { api, usePolling } from "@/lib/api";
import type { Camera, TestResult } from "@/lib/types";

/** Camera management: add, edit, delete, test, enable/disable. */
export default function CamerasPage() {
  const { data, refresh } = usePolling(api.dashboard, 5000);
  const [formCamera, setFormCamera] = useState<Camera | null | undefined>(undefined); // undefined = closed
  const [testResults, setTestResults] = useState<Record<string, TestResult | "pending">>({});

  async function handleDelete(camera: Camera) {
    if (!confirm(`Delete "${camera.name}"? Its events and clips remain in the timeline.`)) return;
    await api.cameras.delete(camera.id);
    void refresh();
  }

  async function handleTest(camera: Camera) {
    setTestResults((prev) => ({ ...prev, [camera.id]: "pending" }));
    const result = await api.cameras.testSaved(camera.id).catch(
      (err): TestResult => ({ ok: false, message: err instanceof Error ? err.message : "Test failed" }),
    );
    setTestResults((prev) => ({ ...prev, [camera.id]: result }));
  }

  const cameras = data?.cameras ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Cameras</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Connect your existing IP cameras. Credentials are encrypted and never leave this machine.
          </p>
        </div>
        <button
          onClick={() => setFormCamera(null)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-zinc-950 hover:brightness-110"
        >
          Add camera
        </button>
      </header>

      {cameras.length === 0 && (
        <p className="rounded-xl border border-dashed border-edge bg-panel px-6 py-14 text-center text-sm text-zinc-600">
          No cameras configured. Add one to start detecting people.
        </p>
      )}

      <div className="grid gap-3">
        {cameras.map((camera) => {
          const test = testResults[camera.id];
          return (
            <div key={camera.id} className="rounded-xl border border-edge bg-panel px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{camera.name}</span>
                    <StatusBadge status={camera.health.status} />
                    {camera.health.activeEvent && (
                      <span className="rounded bg-red-500/15 px-1.5 py-px text-[10px] font-semibold text-red-400">
                        DETECTING
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{camera.location || "No location"}</span>
                    <span className="truncate font-mono text-zinc-600">{camera.rtspUrl}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <ActionButton onClick={() => handleTest(camera)} disabled={test === "pending"}>
                    {test === "pending" ? "Testing…" : "Test"}
                  </ActionButton>
                  <ActionButton onClick={() => setFormCamera(camera)}>Edit</ActionButton>
                  <ActionButton onClick={() => handleDelete(camera)} danger>
                    Delete
                  </ActionButton>
                </div>
              </div>

              {test && test !== "pending" && (
                <div
                  className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                    test.ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-red-500/30 bg-red-500/10 text-red-300"
                  }`}
                >
                  {test.message}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {formCamera !== undefined && (
        <CameraForm
          camera={formCamera}
          onClose={() => setFormCamera(undefined)}
          onSaved={() => {
            setFormCamera(undefined);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-edge px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
        danger ? "text-red-400 hover:bg-red-500/10" : "text-zinc-300 hover:bg-panel-2"
      }`}
    >
      {children}
    </button>
  );
}
