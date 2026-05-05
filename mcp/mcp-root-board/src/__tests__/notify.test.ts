import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadNotificationConfig,
  sendDiscord,
  NOTIFICATION_EVENTS,
  type NotificationConfig,
} from "../notify.js";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// loadNotificationConfig
// ---------------------------------------------------------------------------

describe("loadNotificationConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when config file is missing", () => {
    expect(loadNotificationConfig(tmpDir)).toBeNull();
  });

  it("returns null when notifications.discord section is absent", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({ board: {} }),
      "utf8"
    );
    expect(loadNotificationConfig(tmpDir)).toBeNull();
  });

  it("returns null when discord.enabled is false", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({ notifications: { discord: { enabled: false, events: ["blocker"] } } }),
      "utf8"
    );
    expect(loadNotificationConfig(tmpDir)).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "root.config.json"), "not-json", "utf8");
    expect(loadNotificationConfig(tmpDir)).toBeNull();
  });

  it("returns full config when enabled with explicit events and mention", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({
        notifications: {
          discord: { enabled: true, events: ["blocker", "epic_complete"], mention: "<@&123>" },
        },
      }),
      "utf8"
    );
    expect(loadNotificationConfig(tmpDir)).toEqual({
      enabled: true,
      events: ["blocker", "epic_complete"],
      mention: "<@&123>",
    });
  });

  it("filters out unknown event values", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({
        notifications: {
          discord: { enabled: true, events: ["blocker", "made_up_event", "pr_ready"] },
        },
      }),
      "utf8"
    );
    const cfg = loadNotificationConfig(tmpDir);
    expect(cfg?.events).toEqual(["blocker", "pr_ready"]);
  });

  it("defaults to all events when events array is missing", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({ notifications: { discord: { enabled: true } } }),
      "utf8"
    );
    expect(loadNotificationConfig(tmpDir)?.events).toEqual([...NOTIFICATION_EVENTS]);
  });
});

// ---------------------------------------------------------------------------
// sendDiscord
// ---------------------------------------------------------------------------

describe("sendDiscord", () => {
  const baseConfig: NotificationConfig = {
    enabled: true,
    events: [...NOTIFICATION_EVENTS],
  };

  it("no-ops silently when ROOT_DISCORD_WEBHOOK_URL is unset", async () => {
    delete process.env.ROOT_DISCORD_WEBHOOK_URL;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDiscord("blocker", { title: "x", description: "y" }, baseConfig);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when the event is not in config.events", async () => {
    process.env.ROOT_DISCORD_WEBHOOK_URL = "https://example.test/hook";
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDiscord(
      "epic_complete",
      { title: "x", description: "y" },
      { enabled: true, events: ["blocker"] }
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts an embed with the correct color, title, and footer for the event", async () => {
    process.env.ROOT_DISCORD_WEBHOOK_URL = "https://example.test/hook";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDiscord(
      "blocker",
      { title: "Stream parked", url: "https://gh/x/1", description: "Plan rejected" },
      baseConfig
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/hook");
    const parsed = JSON.parse((init as RequestInit).body as string);
    expect(parsed.embeds[0].title).toBe("Stream parked");
    expect(parsed.embeds[0].url).toBe("https://gh/x/1");
    expect(parsed.embeds[0].color).toBe(0xd32f2f);
    expect(parsed.embeds[0].footer.text).toBe("root · blocker");
  });

  it("includes the mention prefix on blocker events when configured", async () => {
    process.env.ROOT_DISCORD_WEBHOOK_URL = "https://example.test/hook";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDiscord(
      "blocker",
      { title: "x", description: "y" },
      { ...baseConfig, mention: "<@&team>" }
    );

    const parsed = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(parsed.content).toBe("<@&team>");
  });

  it("does NOT include the mention prefix on non-blocker events", async () => {
    process.env.ROOT_DISCORD_WEBHOOK_URL = "https://example.test/hook";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendDiscord(
      "epic_complete",
      { title: "x", description: "y" },
      { ...baseConfig, mention: "<@&team>" }
    );

    const parsed = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(parsed.content).toBeUndefined();
  });

  it("swallows fetch rejection without throwing", async () => {
    process.env.ROOT_DISCORD_WEBHOOK_URL = "https://example.test/hook";
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    await expect(
      sendDiscord("blocker", { title: "x", description: "y" }, baseConfig)
    ).resolves.toBeUndefined();
  });

  it("logs (but does not throw) on non-2xx HTTP response", async () => {
    process.env.ROOT_DISCORD_WEBHOOK_URL = "https://example.test/hook";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const errSpy = jest.spyOn(console, "error");

    await sendDiscord("blocker", { title: "x", description: "y" }, baseConfig);

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
  });
});
