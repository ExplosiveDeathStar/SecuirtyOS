"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { CameraWithHealth } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

/**
 * Live camera tile. Streams MJPEG from the local worker (proxied through the
 * backend) when the camera is online; otherwise shows its status.
 */
export function LivePreview({ camera }: { camera: CameraWithHealth }) {
  const [imgFailed, setImgFailed] = useState(false);
  const streaming = camera.health.status === "online" && !imgFailed;

  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-panel">
      <div className="relative aspect-video bg-black">
        {streaming ? (
          // MJPEG stream — a plain <img> is the correct transport for multipart JPEG.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={api.cameras.previewUrl(camera.id)}
            alt={`Live view of ${camera.name}`}
            className="h-full w-full object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
            <span className="text-xs">{camera.health.error ?? "No signal"}</span>
          </div>
        )}
        {camera.health.activeEvent && (
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-red-500/90 px-2 py-0.5 text-[11px] font-semibold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            DETECTING
          </span>
        )}
        {streaming && camera.health.fps > 0 && (
          <span className="absolute right-3 top-3 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-300">
            {camera.health.fps.toFixed(0)} fps
          </span>
        )}
      </div>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-medium">{camera.name}</div>
          <div className="text-xs text-zinc-500">{camera.location || "No location"}</div>
        </div>
        <StatusBadge status={camera.health.status} />
      </div>
    </div>
  );
}
