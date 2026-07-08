"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Camera, TestResult } from "@/lib/types";

interface Props {
  camera: Camera | null; // null = add mode
  onSaved: () => void;
  onClose: () => void;
}

/** Add / edit camera modal with inline connection testing. */
export function CameraForm({ camera, onSaved, onClose }: Props) {
  const [name, setName] = useState(camera?.name ?? "");
  const [location, setLocation] = useState(camera?.location ?? "");
  const [rtspUrl, setRtspUrl] = useState(camera?.rtspUrl ?? "");
  const [username, setUsername] = useState(camera?.username ?? "");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(camera?.enabled ?? true);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const passwordUnchanged = camera !== null && camera.hasPassword && password === "";

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Editing without retyping the password? Test the saved credentials.
      const result = passwordUnchanged
        ? await api.cameras.testSaved(camera.id)
        : await api.cameras.test({ rtspUrl, username, password });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        location,
        rtspUrl,
        username,
        enabled,
        // Omit password entirely to keep the stored one.
        ...(passwordUnchanged ? {} : { password }),
      };
      if (camera) await api.cameras.update(camera.id, payload);
      else await api.cameras.create(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-edge bg-panel shadow-2xl"
      >
        <div className="border-b border-edge px-6 py-4 text-sm font-semibold">
          {camera ? "Edit camera" : "Add camera"}
        </div>

        <div className="grid gap-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Front Door" className={inputCls} />
            </Field>
            <Field label="Location">
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main entrance" className={inputCls} />
            </Field>
          </div>

          <Field label="Source (RTSP URL, webcam://N, screen://N, or video file path)" required>
            <input
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              required
              placeholder="rtsp://192.168.1.20:554/stream1 — or webcam://0, screen://1"
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" className={inputCls} />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={camera?.hasPassword ? "•••••• (unchanged)" : ""}
                className={inputCls}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-edge bg-panel-2 accent-emerald-400"
            />
            Detection enabled
          </label>

          {testResult && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              {testResult.message}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-edge px-6 py-4">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !rtspUrl}
            className="rounded-lg border border-edge px-3.5 py-2 text-sm text-zinc-300 hover:bg-panel-2 disabled:opacity-40"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <div className="flex gap-2.5">
            <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm text-zinc-400 hover:bg-panel-2">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-zinc-950 hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "Saving…" : camera ? "Save changes" : "Add camera"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-zinc-400">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
