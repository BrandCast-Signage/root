/**
 * Smoke tests for the index module.
 *
 * Full MCP tool handler integration is tested manually; these tests only verify
 * that the module can be imported and its core dependencies resolve correctly.
 */

import {
  DEFAULT_GATE_CONFIG,
  evaluateGate,
  getNextTransition,
  loadGateConfig,
} from "../gates.js";
import { listStreams, readStream, createStream, updateStream, deleteStream } from "../board.js";
import { getIssue, getIssueLabels, setLabel, removeLabel } from "../github.js";
import { createWorktree, removeWorktree, listWorktrees } from "../worktree.js";

// ---------------------------------------------------------------------------
// Module import smoke tests
// ---------------------------------------------------------------------------

describe("index module", () => {
  it("gates module imports without error", () => {
    expect(typeof evaluateGate).toBe("function");
    expect(typeof getNextTransition).toBe("function");
    expect(typeof loadGateConfig).toBe("function");
    expect(DEFAULT_GATE_CONFIG).toBeDefined();
  });

  it("board module imports without error", () => {
    expect(typeof listStreams).toBe("function");
    expect(typeof readStream).toBe("function");
    expect(typeof createStream).toBe("function");
    expect(typeof updateStream).toBe("function");
    expect(typeof deleteStream).toBe("function");
  });

  it("github module imports without error", () => {
    expect(typeof getIssue).toBe("function");
    expect(typeof getIssueLabels).toBe("function");
    expect(typeof setLabel).toBe("function");
    expect(typeof removeLabel).toBe("function");
  });

  it("worktree module imports without error", () => {
    expect(typeof createWorktree).toBe("function");
    expect(typeof removeWorktree).toBe("function");
    expect(typeof listWorktrees).toBe("function");
  });
});
