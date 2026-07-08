"use client";

import Link from "next/link";
import { useState } from "react";
import { EventCard } from "@/components/EventCard";
import { EventModal } from "@/components/EventModal";
import { LivePreview } from "@/components/LivePreview";
import { api, usePolling } from "@/lib/api";
import type { SecurityEvent } from "@/lib/types";

/** Dashboard: live cameras, today's activity, and what's happening right now. */
export default function DashboardPage() {
  const { data, error } = usePolling(api.dashboard, 4000);
  const [selected, setSelected] = useState<SecurityEvent | null>(null);

  if (error && !data) {
    return (
      <EmptyState
        title="Backend unreachable"
        body="Start the SecurityOS backend (npm run dev in backend/) and refresh."
      />
    );
  }
  if (!data) return <div className="py-24 text-center text-sm text-zinc-600">Loading…</div>;

  const online = data.cameras.filter((c) => c.health.status === "online").length;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="mt-0.5 text-sm text-zinc-500">What&apos;s happening across your cameras.</p>
        </div>
        {!data.workerAlive && (
          <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            Detection worker offline — live analysis paused
          </span>
        )}
      </header>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Detections today" value={data.stats.today} />
        <Stat label="Active right now" value={data.stats.activeNow} highlight={data.stats.activeNow > 0} />
        <Stat label="Cameras online" value={`${online} / ${data.cameras.length}`} />
        <Stat label="Total events" value={data.stats.total} />
      </div>

      {data.activeEvents.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-red-400">Happening now</h2>
          <div className="grid gap-2.5">
            {data.activeEvents.map((event) => (
              <EventCard key={event.id} event={event} onClick={() => setSelected(event)} />
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">Live cameras</h2>
        {data.cameras.length === 0 ? (
          <EmptyState
            title="No cameras yet"
            body="Add your first IP camera to start detecting."
            action={
              <Link href="/cameras" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-zinc-950">
                Add camera
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.cameras.map((camera) => (
              <LivePreview key={camera.id} camera={camera} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Recent detections</h2>
          <Link href="/timeline" className="text-xs text-accent hover:underline">
            View full timeline →
          </Link>
        </div>
        {data.recentEvents.length === 0 ? (
          <p className="rounded-xl border border-edge bg-panel px-4 py-6 text-center text-sm text-zinc-600">
            No detections yet. When someone appears on camera, it shows up here.
          </p>
        ) : (
          <div className="grid gap-2.5">
            {data.recentEvents.map((event) => (
              <EventCard key={event.id} event={event} onClick={() => setSelected(event)} />
            ))}
          </div>
        )}
      </section>

      {selected && <EventModal event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-5 py-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${highlight ? "text-red-400" : ""}`}>{value}</div>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge bg-panel px-6 py-14 text-center">
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      <p className="max-w-sm text-sm text-zinc-500">{body}</p>
      {action}
    </div>
  );
}
