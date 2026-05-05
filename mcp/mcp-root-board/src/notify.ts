import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The four-event taxonomy fired by Root for autonomous-mode signaling.
 * Kept deliberately small: chatty per-step events would drown the channel.
 */
export type NotificationEvent = "blocker" | "human_gate" | "pr_ready" | "epic_complete";

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  "blocker",
  "human_gate",
  "pr_ready",
  "epic_complete",
] as const;

/**
 * Parsed `notifications.discord` block from `root.config.json`.
 *
 * The webhook URL is intentionally NOT in this shape — it lives in the
 * `ROOT_DISCORD_WEBHOOK_URL` environment variable, never in a committed file.
 */
export interface NotificationConfig {
  enabled: boolean;
  events: NotificationEvent[];
  mention?: string;
}

/**
 * Payload accepted by {@link sendDiscord}. The notifier maps it to a
 * Discord embed: title/url at the top, description below, fields rendered
 * as inline key/value pairs.
 */
export interface NotificationPayload {
  title: string;
  url?: string;
  description: string;
  fields?: Array<{ name: string; value: string }>;
}

const EVENT_COLOR: Record<NotificationEvent, number> = {
  blocker: 0xd32f2f,        // red
  human_gate: 0xf9a825,     // amber
  pr_ready: 0x1e88e5,       // blue
  epic_complete: 0x43a047,  // green
};

/**
 * Load `notifications.discord` from `root.config.json`. Returns `null` when
 * the file is missing, malformed, the section is absent, or the section has
 * `enabled: false` — which is the explicit "feature off" signal.
 *
 * @param rootDir - Absolute path to the consumer project root.
 */
export function loadNotificationConfig(rootDir: string): NotificationConfig | null {
  try {
    const raw = readFileSync(join(rootDir, "root.config.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      notifications?: { discord?: Partial<NotificationConfig> };
    };
    const cfg = parsed?.notifications?.discord;
    if (cfg === undefined || cfg.enabled !== true) {
      return null;
    }
    const events = Array.isArray(cfg.events)
      ? (cfg.events.filter((e): e is NotificationEvent =>
          NOTIFICATION_EVENTS.includes(e as NotificationEvent)
        ))
      : [...NOTIFICATION_EVENTS];
    return {
      enabled: true,
      events,
      mention: typeof cfg.mention === "string" ? cfg.mention : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Post a Discord embed to the webhook in `ROOT_DISCORD_WEBHOOK_URL`.
 *
 * No-ops silently when:
 *  - the env var is unset (deliberate "no webhook configured" signal)
 *  - the resolved config does not include `event` in its `events` array
 *
 * Network or HTTP errors are caught and logged to stderr but never thrown —
 * notification failure must not break a real workflow.
 *
 * @param event   - One of the four notification events.
 * @param payload - Title, URL, description, and optional fields.
 * @param config  - Resolved {@link NotificationConfig} from {@link loadNotificationConfig}.
 */
export async function sendDiscord(
  event: NotificationEvent,
  payload: NotificationPayload,
  config: NotificationConfig
): Promise<void> {
  const webhookUrl = process.env.ROOT_DISCORD_WEBHOOK_URL;
  if (webhookUrl === undefined || webhookUrl.length === 0) {
    return;
  }
  if (!config.events.includes(event)) {
    return;
  }

  const body: Record<string, unknown> = {
    embeds: [
      {
        title: payload.title,
        url: payload.url,
        description: payload.description,
        color: EVENT_COLOR[event],
        fields: (payload.fields ?? []).map((f) => ({
          name: f.name,
          value: f.value,
          inline: true,
        })),
        footer: { text: `root · ${event}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  if (event === "blocker" && config.mention !== undefined) {
    body.content = config.mention;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[notify] Discord webhook returned ${res.status} for event=${event}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[notify] Discord webhook failed for event=${event}: ${msg}`);
  }
}
