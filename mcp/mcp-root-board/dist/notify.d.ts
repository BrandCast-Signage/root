/**
 * The four-event taxonomy fired by Root for autonomous-mode signaling.
 * Kept deliberately small: chatty per-step events would drown the channel.
 */
export type NotificationEvent = "blocker" | "human_gate" | "pr_ready" | "epic_complete";
export declare const NOTIFICATION_EVENTS: readonly NotificationEvent[];
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
    fields?: Array<{
        name: string;
        value: string;
    }>;
}
/**
 * Load `notifications.discord` from `root.config.json`. Returns `null` when
 * the file is missing, malformed, the section is absent, or the section has
 * `enabled: false` — which is the explicit "feature off" signal.
 *
 * @param rootDir - Absolute path to the consumer project root.
 */
export declare function loadNotificationConfig(rootDir: string): NotificationConfig | null;
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
export declare function sendDiscord(event: NotificationEvent, payload: NotificationPayload, config: NotificationConfig): Promise<void>;
