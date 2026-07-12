"use client";

import { useState } from "react";
import { api, usePolling } from "@/lib/api";
import type { Person } from "@/lib/types";

/**
 * People: every individual recognized by face ID. Rename them, mark them
 * safe, merge duplicates, pick their photo, and see objective sighting
 * counts — today, this week, all time.
 */
export default function PeoplePage() {
  const { data: persons, refresh } = usePolling(api.persons.list, 5000);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveName(person: Person) {
    if (!draftName.trim() || draftName.trim() === person.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await api.persons.update(person.id, { name: draftName.trim() });
      await refresh();
    } finally {
      setBusy(false);
      setEditingId(null);
    }
  }

  async function toggleSafe(person: Person) {
    setBusy(true);
    try {
      await api.persons.update(person.id, { safe: !person.safe });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function forget(person: Person) {
    if (!confirm(`Forget "${person.name}"? Their face profile is deleted; past events stay in the timeline.`)) return;
    await api.persons.delete(person.id);
    void refresh();
  }

  /** Merge `person` (the duplicate) into `target` — target keeps the profile. */
  async function mergeInto(person: Person, target: Person) {
    setBusy(true);
    try {
      await api.persons.merge(target.id, person.id);
      await refresh();
    } finally {
      setBusy(false);
      setMergingId(null);
    }
  }

  async function pickPhoto(person: Person, faceUrl: string) {
    setBusy(true);
    try {
      await api.persons.update(person.id, { faceUrl });
      await refresh();
    } finally {
      setBusy(false);
      setPhotosFor(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">People</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Everyone recognized on camera, with how often they show up. Rename anyone, mark trusted
          people as safe, and merge duplicates if the AI split one person in two.
        </p>
      </header>

      {(!persons || persons.length === 0) && (
        <p className="rounded-xl border border-dashed border-edge bg-panel px-6 py-14 text-center text-sm text-zinc-600">
          No people identified yet. When a clear face appears on camera, it shows up here.
        </p>
      )}

      <div className="grid gap-3">
        {(persons ?? []).map((person) => (
          <div key={person.id} className="rounded-xl border border-edge bg-panel px-5 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setPhotosFor(person)}
                title="View captured photos / change picture"
                className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black ring-1 ring-edge transition-shadow hover:ring-accent/60"
              >
                {person.faceUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={person.faceUrl} alt={person.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-700">
                    <PersonIcon />
                  </div>
                )}
                {person.faceUrls.length > 1 && (
                  <span className="absolute bottom-0 inset-x-0 bg-black/70 py-px text-center text-[9px] font-semibold text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                    {person.faceUrls.length} photos
                  </span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  {editingId === person.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => void saveName(person)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveName(person);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-44 rounded-lg border border-edge bg-panel-2 px-2 py-1 text-sm text-zinc-200 focus:border-accent/50 focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(person.id);
                        setDraftName(person.name);
                      }}
                      title="Rename"
                      className="text-sm font-semibold hover:text-accent"
                    >
                      {person.name}
                    </button>
                  )}
                  {person.safe && (
                    <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold text-emerald-300">
                      SAFE
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  <Stat value={person.visitsToday} label="today" />
                  <Stat value={person.visitsLast7d} label="last 7 days" />
                  <Stat value={person.visitCount} label="all time" />
                  <span>
                    last seen{" "}
                    {new Date(person.lastSeenAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => void toggleSafe(person)}
                  disabled={busy}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                    person.safe
                      ? "border-edge text-zinc-300 hover:bg-panel-2"
                      : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                  }`}
                >
                  {person.safe ? "Unmark safe" : "Mark safe"}
                </button>
                {(persons?.length ?? 0) > 1 && (
                  <button
                    onClick={() => setMergingId(mergingId === person.id ? null : person.id)}
                    disabled={busy}
                    className="rounded-lg border border-edge px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-panel-2 disabled:opacity-40"
                  >
                    Merge
                  </button>
                )}
                <button
                  onClick={() => void forget(person)}
                  disabled={busy}
                  className="rounded-lg border border-edge px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                >
                  Forget
                </button>
              </div>
            </div>

            {mergingId === person.id && (
              <div className="mt-3 rounded-lg border border-edge bg-panel-2 px-4 py-3">
                <div className="text-xs text-zinc-400">
                  <span className="font-medium text-zinc-200">{person.name}</span> is the same person
                  as… <span className="text-zinc-600">(the one you pick keeps the profile)</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(persons ?? [])
                    .filter((p) => p.id !== person.id)
                    .map((target) => (
                      <button
                        key={target.id}
                        onClick={() => void mergeInto(person, target)}
                        disabled={busy}
                        className="flex items-center gap-2 rounded-lg border border-edge bg-panel px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-accent/50 hover:bg-panel-2 disabled:opacity-40"
                      >
                        <span className="h-6 w-6 overflow-hidden rounded-full bg-black">
                          {target.faceUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={target.faceUrl} alt={target.name} className="h-full w-full object-cover" />
                          )}
                        </span>
                        {target.name}
                      </button>
                    ))}
                  <button
                    onClick={() => setMergingId(null)}
                    className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-panel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {photosFor && (
        <PhotoPicker
          person={photosFor}
          busy={busy}
          onPick={(url) => void pickPhoto(photosFor, url)}
          onClose={() => setPhotosFor(null)}
        />
      )}
    </div>
  );
}

/** Carousel of every face photo the camera captured; click one to make it the picture. */
function PhotoPicker({
  person,
  busy,
  onPick,
  onClose,
}: {
  person: Person;
  busy: boolean;
  onPick: (faceUrl: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <div>
            <div className="text-sm font-semibold">{person.name} — captured photos</div>
            <div className="text-xs text-zinc-500">Click a photo to use it as their picture.</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-panel-2 hover:text-zinc-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {person.faceUrls.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-600">
            No photos captured yet — they appear as the camera sees this person clearly.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto px-5 py-5">
            {person.faceUrls.map((url) => {
              const current = url === person.faceUrl;
              return (
                <button
                  key={url}
                  onClick={() => onPick(url)}
                  disabled={busy || current}
                  className={`relative h-32 w-28 shrink-0 overflow-hidden rounded-xl bg-black ring-2 transition-shadow ${
                    current ? "ring-accent" : "ring-transparent hover:ring-accent/50"
                  } disabled:cursor-default`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={person.name} className="h-full w-full object-cover" />
                  {current && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/80 px-1.5 py-px text-[10px] font-semibold text-accent">
                      Current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** One objective count, e.g. "12 sightings last 7 days". */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-zinc-300">{value}</span> sighting{value === 1 ? "" : "s"} {label}
    </span>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
      />
    </svg>
  );
}
