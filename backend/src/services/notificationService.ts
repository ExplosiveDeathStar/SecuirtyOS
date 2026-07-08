/**
 * Notification Service — tells the user when something is detected.
 *
 * Channels are pluggable: Phase 1 ships native desktop notifications (macOS
 * osascript / Linux notify-send). Future channels (webhooks, mobile push,
 * email) implement `NotificationChannel` and register in `channels` below.
 *
 * A per-camera/per-type cooldown prevents notification spam when someone
 * lingers at the edge of frame and triggers back-to-back events.
 */
import { execFile } from "node:child_process";
import type { SecurityEvent } from "../types.js";

const ENABLED = (process.env.SECURITYOS_NOTIFY ?? "true") !== "false";
const COOLDOWN_MS = Number(process.env.SECURITYOS_NOTIFY_COOLDOWN ?? 60) * 1000;

const TYPE_LABELS: Record<string, string> = {
  person: "Person",
  animal: "Animal",
  vehicle: "Vehicle",
};

export interface AppNotification {
  title: string;
  body: string;
}

export interface NotificationChannel {
  name: string;
  send(notification: AppNotification): Promise<void>;
}

/** Native desktop notification via the OS notification center. */
class DesktopChannel implements NotificationChannel {
  name = "desktop";

  async send(notification: AppNotification): Promise<void> {
    if (process.platform === "darwin") {
      const script = `display notification "${escapeAppleScript(notification.body)}" with title "${escapeAppleScript(notification.title)}" sound name "Ping"`;
      await run("osascript", ["-e", script]);
    } else if (process.platform === "linux") {
      await run("notify-send", [notification.title, notification.body]);
    }
  }
}

function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => (error ? reject(error) : resolve()));
  });
}

class NotificationService {
  private channels: NotificationChannel[] = [new DesktopChannel()];
  private lastSent = new Map<string, number>(); // "cameraId:type" -> timestamp

  /** Notify about a newly opened detection event (rate-limited per camera+type). */
  async notifyEventOpened(event: SecurityEvent): Promise<void> {
    if (!ENABLED) return;
    const key = `${event.cameraId}:${event.type}`;
    const now = Date.now();
    const last = this.lastSent.get(key) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    this.lastSent.set(key, now);

    const label = TYPE_LABELS[event.type] ?? event.type;
    const where = event.cameraLocation ? `${event.cameraName} (${event.cameraLocation})` : event.cameraName;
    await this.send({
      title: `SecurityOS — ${label} detected`,
      body: `${where} · confidence ${Math.round(event.confidence * 100)}%`,
    });
  }

  /** Send through every channel; one failing channel never blocks the rest. */
  async send(notification: AppNotification): Promise<void> {
    await Promise.allSettled(
      this.channels.map(async (channel) => {
        try {
          await channel.send(notification);
        } catch (error) {
          console.warn(`[notifications] ${channel.name} channel failed:`, error);
        }
      }),
    );
  }
}

export const notificationService = new NotificationService();
