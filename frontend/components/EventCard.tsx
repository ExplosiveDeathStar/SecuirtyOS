"use client";

import { eventTypeLabel, formatConfidence, formatDuration, formatTime } from "@/lib/format";
import type { SecurityEvent } from "@/lib/types";

/**
 * One timeline entry: the answer to "what happened?" — who/where/when/how long,
 * with a thumbnail. Clicking opens the recorded clip.
 */
export function EventCard({ event, onClick }: { event: SecurityEvent; onClick: () => void }) {
  const active = event.status === "active";
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-stretch gap-4 rounded-xl border border-edge bg-panel p-3 text-left transition-colors hover:border-accent/40 hover:bg-panel-2"
    >
      <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-black">
        {event.snapshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.snapshotUrl} alt="Detection snapshot" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
              />
            </svg>
          </div>
        )}
        {active && (
          <span className="absolute left-1.5 top-1.5 rounded bg-red-500/90 px-1.5 py-px text-[10px] font-semibold text-white">
            LIVE
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tabular-nums">{formatTime(event.startedAt)}</span>
          <span className="truncate text-sm text-zinc-300">{event.cameraName}</span>
          {event.cameraLocation && (
            <span className="truncate text-xs text-zinc-500">{event.cameraLocation}</span>
          )}
        </div>
        <div className="text-sm text-zinc-400">
          {event.persons.length > 0
            ? event.persons.map((p) => p.name).join(", ")
            : eventTypeLabel(event.type)}{" "}
          detected
          {active ? (
            <span className="text-red-400"> — happening now</span>
          ) : (
            <> · stayed {formatDuration(event.durationS)}</>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Confidence {formatConfidence(event.confidence)}</span>
          {event.persons.map((p) => (
            <span
              key={p.id}
              className="rounded-md border border-edge bg-panel-2 px-1.5 py-px text-[10px] tabular-nums"
              title={`${p.name}: ${p.visitCount} total sightings, ${p.visitsLast7d} in the last 7 days`}
            >
              {p.name} · {p.visitsLast7d}× this week
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center pr-2 text-zinc-600 transition-colors group-hover:text-accent">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
          <path
            fillRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm14.024-.983a1.125 1.125 0 010 1.966l-5.603 3.113A1.125 1.125 0 019 15.113V8.887c0-.857.921-1.4 1.671-.983l5.603 3.113z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </button>
  );
}
