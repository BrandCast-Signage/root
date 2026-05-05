"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATION_EVENTS = void 0;
exports.loadNotificationConfig = loadNotificationConfig;
exports.sendDiscord = sendDiscord;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.NOTIFICATION_EVENTS = [
    "blocker",
    "human_gate",
    "pr_ready",
    "epic_complete",
];
const EVENT_COLOR = {
    blocker: 0xd32f2f, // red
    human_gate: 0xf9a825, // amber
    pr_ready: 0x1e88e5, // blue
    epic_complete: 0x43a047, // green
};
/**
 * Load `notifications.discord` from `root.config.json`. Returns `null` when
 * the file is missing, malformed, the section is absent, or the section has
 * `enabled: false` — which is the explicit "feature off" signal.
 *
 * @param rootDir - Absolute path to the consumer project root.
 */
function loadNotificationConfig(rootDir) {
    try {
        const raw = (0, node_fs_1.readFileSync)((0, node_path_1.join)(rootDir, "root.config.json"), "utf8");
        const parsed = JSON.parse(raw);
        const cfg = parsed?.notifications?.discord;
        if (cfg === undefined || cfg.enabled !== true) {
            return null;
        }
        const events = Array.isArray(cfg.events)
            ? (cfg.events.filter((e) => exports.NOTIFICATION_EVENTS.includes(e)))
            : [...exports.NOTIFICATION_EVENTS];
        return {
            enabled: true,
            events,
            mention: typeof cfg.mention === "string" ? cfg.mention : undefined,
        };
    }
    catch {
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
async function sendDiscord(event, payload, config) {
    const webhookUrl = process.env.ROOT_DISCORD_WEBHOOK_URL;
    if (webhookUrl === undefined || webhookUrl.length === 0) {
        return;
    }
    if (!config.events.includes(event)) {
        return;
    }
    const body = {
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
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[notify] Discord webhook failed for event=${event}: ${msg}`);
    }
}
