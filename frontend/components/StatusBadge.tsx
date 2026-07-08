import type { CameraHealth } from "@/lib/types";

const STYLES: Record<CameraHealth["status"], { dot: string; text: string; label: string }> = {
  online: { dot: "bg-emerald-400", text: "text-emerald-400", label: "Online" },
  connecting: { dot: "bg-amber-400 animate-pulse", text: "text-amber-400", label: "Connecting" },
  offline: { dot: "bg-red-400", text: "text-red-400", label: "Offline" },
  disabled: { dot: "bg-zinc-600", text: "text-zinc-500", label: "Disabled" },
  unknown: { dot: "bg-zinc-600", text: "text-zinc-500", label: "Worker offline" },
};

export function StatusBadge({ status }: { status: CameraHealth["status"] }) {
  const style = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${style.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
