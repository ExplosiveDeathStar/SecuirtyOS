"use client";

import { useCallback, useState } from "react";
import { EventCard } from "@/components/EventCard";
import { EventModal } from "@/components/EventModal";
import { api, usePolling } from "@/lib/api";
import { formatDay } from "@/lib/format";
import type { SecurityEvent } from "@/lib/types";

/**
 * Event timeline: every detection, newest first, grouped by day.
 * This page is the product — "what happened?" without watching footage.
 */
export default function TimelinePage() {
  const [cameraFilter, setCameraFilter] = useState<string>("");
  const [selected, setSelected] = useState<SecurityEvent | null>(null);

  const fetchEvents = useCallback(
    () => api.events.list(cameraFilter ? { cameraId: cameraFilter, limit: "200" } : { limit: "200" }),
    [cameraFilter],
  );
  const { data: events } = usePolling(fetchEvents, 5000);
  const { data: cameras } = usePolling(api.cameras.list, 30000);

  const groups = groupByDay(events ?? []);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Timeline</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Every detection, newest first.</p>
        </div>
        <select
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value)}
          className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-zinc-300 focus:outline-none"
        >
          <option value="">All cameras</option>
          {(cameras ?? []).map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.name}
            </option>
          ))}
        </select>
      </header>

      {events && events.length === 0 && (
        <p className="rounded-xl border border-dashed border-edge bg-panel px-6 py-14 text-center text-sm text-zinc-600">
          No events yet. Detections will appear here the moment a person is seen.
        </p>
      )}

      {groups.map(([day, dayEvents]) => (
        <section key={day} className="mb-7">
          <h2 className="sticky top-0 z-10 -mx-2 mb-3 bg-surface/95 px-2 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur">
            {day}
          </h2>
          <div className="grid gap-2.5">
            {dayEvents.map((event) => (
              <EventCard key={event.id} event={event} onClick={() => setSelected(event)} />
            ))}
          </div>
        </section>
      ))}

      {selected && <EventModal event={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function groupByDay(events: SecurityEvent[]): [string, SecurityEvent[]][] {
  const map = new Map<string, SecurityEvent[]>();
  for (const event of events) {
    const day = formatDay(event.startedAt);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(event);
  }
  return [...map.entries()];
}
