import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_GATE_CONFIG,
  evaluateGate,
  getNextTransition,
  loadGateConfig,
} from "../gates.js";
import { GateConfig } from "../types.js";

// ---------------------------------------------------------------------------
// evaluateGate
// ---------------------------------------------------------------------------

describe("evaluateGate", () => {
  it("plan_approval / tier1 → human (TierGateConfig path)", () => {
    const result = evaluateGate("plan_approval", "tier1", DEFAULT_GATE_CONFIG);
    expect(result.action).toBe("human");
    expect(result.reason).toMatch(/human/i);
  });

  it("plan_approval / tier2 → auto (TierGateConfig path)", () => {
    const result = evaluateGate("plan_approval", "tier2", DEFAULT_GATE_CONFIG);
    expect(result.action).toBe("auto");
  });

  it("validation / tier1 → auto (plain GateAction path)", () => {
    const result = evaluateGate("validation", "tier1", DEFAULT_GATE_CONFIG);
    expect(result.action).toBe("auto");
  });

  it("reviewer_pass / tier1 → auto", () => {
    const result = evaluateGate("reviewer_pass", "tier1", DEFAULT_GATE_CONFIG);
    expect(result.action).toBe("auto");
  });

  it("pr_creation / tier2 → auto", () => {
    const result = evaluateGate("pr_creation", "tier2", DEFAULT_GATE_CONFIG);
    expect(result.action).toBe("auto");
  });

  it("unknown gate name defaults to auto", () => {
    const result = evaluateGate("nonexistent_gate", "tier1", DEFAULT_GATE_CONFIG);
    expect(result.action).toBe("auto");
    expect(result.reason).toMatch(/not found/i);
  });

  it("custom config overrides defaults — plan_approval tier1 forced to auto", () => {
    const customConfig: GateConfig = {
      ...DEFAULT_GATE_CONFIG,
      plan_approval: { tier1: "auto", tier2: "auto" },
    };
    const result = evaluateGate("plan_approval", "tier1", customConfig);
    expect(result.action).toBe("auto");
  });

  it("custom config overrides defaults — validation forced to human", () => {
    const customConfig: GateConfig = {
      ...DEFAULT_GATE_CONFIG,
      validation: "human",
    };
    const result = evaluateGate("validation", "tier1", customConfig);
    expect(result.action).toBe("human");
  });
});

// ---------------------------------------------------------------------------
// getNextTransition
// ---------------------------------------------------------------------------

describe("getNextTransition", () => {
  it('queued → { next: "planning", gate: null }', () => {
    const t = getNextTransition("queued");
    expect(t).toEqual({ next: "planning", gate: null });
  });

  it('planning → { next: "plan-ready", gate: null }', () => {
    const t = getNextTransition("planning");
    expect(t).toEqual({ next: "plan-ready", gate: null });
  });

  it('plan-ready → { next: "approved", gate: "plan_approval" }', () => {
    const t = getNextTransition("plan-ready");
    expect(t).toEqual({ next: "approved", gate: "plan_approval" });
  });

  it('approved → { next: "implementing", gate: null }', () => {
    const t = getNextTransition("approved");
    expect(t).toEqual({ next: "implementing", gate: null });
  });

  it('implementing → { next: "validating", gate: null }', () => {
    const t = getNextTransition("implementing");
    expect(t).toEqual({ next: "validating", gate: null });
  });

  it('validating → { next: "pr-ready", gate: "validation" }', () => {
    const t = getNextTransition("validating");
    expect(t).toEqual({ next: "pr-ready", gate: "validation" });
  });

  it('pr-ready → { next: "merged", gate: null }', () => {
    const t = getNextTransition("pr-ready");
    expect(t).toEqual({ next: "merged", gate: null });
  });

  it("merged → null (terminal state)", () => {
    expect(getNextTransition("merged")).toBeNull();
  });

  it("blocked → null (terminal state)", () => {
    expect(getNextTransition("blocked")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadGateConfig
// ---------------------------------------------------------------------------

describe("loadGateConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gates-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadGateConfig(tmpDir);
    expect(config).toEqual(DEFAULT_GATE_CONFIG);
  });

  it("returns defaults when config has no board section", () => {
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify({ someOtherKey: true }),
      "utf8"
    );
    const config = loadGateConfig(tmpDir);
    expect(config).toEqual(DEFAULT_GATE_CONFIG);
  });

  it("returns defaults on invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "root.config.json"), "not-valid-json", "utf8");
    const config = loadGateConfig(tmpDir);
    expect(config).toEqual(DEFAULT_GATE_CONFIG);
  });

  it("merges user gate config over defaults", () => {
    const userConfig = {
      board: {
        gates: {
          plan_approval: { tier1: "auto", tier2: "auto" },
          validation: "human",
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "root.config.json"),
      JSON.stringify(userConfig),
      "utf8"
    );

    const config = loadGateConfig(tmpDir);
    expect(config.plan_approval).toEqual({ tier1: "auto", tier2: "auto" });
    expect(config.validation).toBe("human");
    // Non-overridden keys come from defaults.
    expect(config.reviewer_pass).toBe("auto");
    expect(config.pr_creation).toBe("auto");
  });
});
