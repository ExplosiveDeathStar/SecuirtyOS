"use client";

import { useEffect } from "react";
import { eventTypeLabel, formatConfidence, formatDay, formatDuration, formatTime } from "@/lib/format";
import type { SecurityEvent } from "@/lib/types";

/** Full event view: the recorded clip plus everything we know about the moment. */
export function EventModal({ event, onClose }: { event: SecurityEvent; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div>
            <div className="text-sm font-semibold">
              {event.cameraName}
              {event.cameraLocation && <span className="ml-2 font-normal text-zinc-500">{event.cameraLocation}</span>}
            </div>
            <div className="text-xs text-zinc-500">
              {formatDay(event.startedAt)} · {formatTime(event.startedAt)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-panel-2 hover:text-zinc-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-black">
          {event.clipUrl ? (
            <video src={event.clipUrl} controls autoPlay className="max-h-[60vh] w-full" poster={event.snapshotUrl ?? undefined} />
          ) : event.snapshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.snapshotUrl} alt="Detection snapshot" className="max-h-[60vh] w-full object-contain" />
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-zinc-600">
              {event.status === "active" ? "Recording in progress…" : "No media available"}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 divide-x divide-edge border-t border-edge">
          <Fact
            label="Detection"
            value={
              event.persons.length > 0
                ? event.persons.map((p) => p.name).join(", ")
                : eventTypeLabel(event.type)
            }
          />
          <Fact
            label="Duration"
            value={event.status === "active" ? "In progress" : formatDuration(event.durationS)}
          />
          <Fact label="Confidence" value={formatConfidence(event.confidence)} />
        </div>

        {event.persons.length > 0 && (
          <div className="border-t border-edge px-5 py-3.5">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">Sighting frequency</div>
            <div className="mt-1 grid gap-1">
              {event.persons.map((p) => (
                <div key={p.id} className="text-xs text-zinc-400">
                  <span className="font-medium text-zinc-200">{p.name}</span>
                  {p.safe && (
                    <span className="ml-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-1 text-[10px] font-semibold text-emerald-300">
                      SAFE
                    </span>
                  )}
                  <span className="tabular-nums">
                    {" "}· {p.visitsLast7d} sighting{p.visitsLast7d === 1 ? "" : "s"} in the last 7 days ·{" "}
                    {p.visitCount} all time
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3.5">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
