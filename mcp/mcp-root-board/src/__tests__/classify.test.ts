import { classifyTier, scopeSignal } from "../classify.js";

describe("classifyTier", () => {
  describe("label precedence", () => {
    it("type:feature alone → tier2 (label is not a Tier 1 signal; triage over-applies it)", () => {
      const result = classifyTier({ title: "anything", labels: ["type:feature"] });
      expect(result.tier).toBe("tier2");
    });

    it("type:feature with Tier 1 keywords in title → tier1 via keywords", () => {
      const result = classifyTier({
        title: "Feature: schema change for billing",
        labels: ["type:feature"],
      });
      expect(result.tier).toBe("tier1");
      expect(result.reason).toMatch(/schema change/);
    });

    it("type:bug → tier2 even if title has tier1 keywords", () => {
      const result = classifyTier({
        title: "Refactor the auth migration",
        labels: ["type:bug"],
      });
      expect(result.tier).toBe("tier2");
      expect(result.reason).toMatch(/type:bug/);
    });

    it("type:refactor → tier1", () => {
      const result = classifyTier({ title: "x", labels: ["type:refactor"] });
      expect(result.tier).toBe("tier1");
    });

    it("type:dependencies → tier2", () => {
      const result = classifyTier({ title: "x", labels: ["type:dependencies"] });
      expect(result.tier).toBe("tier2");
    });

    it("label matching is case-insensitive", () => {
      const result = classifyTier({ title: "x", labels: ["TYPE:Refactor"] });
      expect(result.tier).toBe("tier1");
    });

    it("first matching type label wins — tier1 before tier2", () => {
      const result = classifyTier({
        title: "x",
        labels: ["type:refactor", "type:bug"],
      });
      expect(result.tier).toBe("tier1");
    });
  });

  describe("keyword fallback when no type:* label", () => {
    it("title with 'refactor' → tier1", () => {
      const result = classifyTier({
        title: "Refactor the notification pipeline",
        labels: ["area:backend"],
      });
      expect(result.tier).toBe("tier1");
      expect(result.reason).toMatch(/refactor/);
    });

    it("title with 'fix' → tier2", () => {
      const result = classifyTier({
        title: "fix null deref in token refresh",
        labels: [],
      });
      expect(result.tier).toBe("tier2");
    });

    it("body keywords count toward classification", () => {
      const result = classifyTier({
        title: "Weather work",
        body: "Need to integrate a new integration and implement schema change",
        labels: [],
      });
      expect(result.tier).toBe("tier1");
    });

    it("equal keyword hits → tier2 ambiguous policy", () => {
      const result = classifyTier({
        title: "refactor and fix something",
        labels: [],
      });
      expect(result.tier).toBe("tier2");
      expect(result.reason).toMatch(/ambiguous/);
    });
  });

  describe("ambiguous policy", () => {
    it("no labels, no keywords → tier2 with override hint", () => {
      const result = classifyTier({
        title: "Do the thing",
        labels: ["area:frontend"],
      });
      expect(result.tier).toBe("tier2");
      expect(result.reason).toMatch(/ambiguous/);
      expect(result.reason).toMatch(/override/);
    });

    it("does not silently default — reason always populated", () => {
      const result = classifyTier({ title: "", labels: [] });
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// scopeSignal — unit tests for each signal independently
// ---------------------------------------------------------------------------

describe("scopeSignal", () => {
  // ── small ────────────────────────────────────────────────────────────────

  it("small: true — body has ≤3 file refs", () => {
    const result = scopeSignal({
      title: "Update thing",
      body: "See mcp/foo.ts and src/bar.md for details.",
    });
    expect(result.small).toBe(true);
  });

  it("small: false — body has >3 file refs", () => {
    const result = scopeSignal({
      title: "Update thing",
      body: "Files: a.ts b.ts c.ts d.ts are all affected.",
    });
    expect(result.small).toBe(false);
  });

  it("small: true — Files affected section overrides body count", () => {
    const body = [
      "This issue touches many files across the codebase.",
      "See also: extra1.ts extra2.ts extra3.ts extra4.ts extra5.ts",
      "",
      "## Files affected",
      "- src/classify.ts",
      "- src/index.ts",
      "",
      "## Background",
      "More info here.",
    ].join("\n");
    const result = scopeSignal({ title: "Fix thing", body });
    expect(result.small).toBe(true);
  });

  it("small: false — no body", () => {
    const result = scopeSignal({ title: "Update thing", body: undefined });
    expect(result.small).toBe(false);
  });

  it("small: false — empty body", () => {
    const result = scopeSignal({ title: "Update thing", body: "" });
    expect(result.small).toBe(false);
  });

  // ── locked ───────────────────────────────────────────────────────────────

  it("locked: true — matching heading + ≥2 bullets", () => {
    const body = [
      "Some context here.",
      "",
      "## Acceptance criteria",
      "- [ ] The function returns correct value",
      "- [ ] Tests pass",
      "- [ ] No lint errors",
    ].join("\n");
    const result = scopeSignal({ title: "Fix thing", body });
    expect(result.locked).toBe(true);
  });

  it("locked: false — heading present but only 1 bullet", () => {
    const body = [
      "Some context.",
      "",
      "## Acceptance criteria",
      "- [ ] Tests pass",
    ].join("\n");
    const result = scopeSignal({ title: "Fix thing", body });
    expect(result.locked).toBe(false);
  });

  it("locked: false — no matching heading", () => {
    const body = [
      "Some context.",
      "",
      "## Background",
      "- [ ] Tests pass",
      "- [ ] Lint passes",
    ].join("\n");
    const result = scopeSignal({ title: "Fix thing", body });
    expect(result.locked).toBe(false);
  });

  it("locked: true — 'Done when' heading variant", () => {
    const body = [
      "Context.",
      "",
      "## Done when",
      "- [ ] Function renamed",
      "- [ ] All callers updated",
    ].join("\n");
    const result = scopeSignal({ title: "Fix thing", body });
    expect(result.locked).toBe(true);
  });

  it("locked: true — 'Acceptance' heading (short form)", () => {
    const body = [
      "Context.",
      "",
      "## Acceptance",
      "- [ ] Change is deployed",
      "- [ ] No regressions",
    ].join("\n");
    const result = scopeSignal({ title: "Fix thing", body });
    expect(result.locked).toBe(true);
  });

  // ── mechanical ───────────────────────────────────────────────────────────

  it("mechanical: true — keyword in title", () => {
    const result = scopeSignal({
      title: "rename the foo function to bar",
      body: "See the code.",
    });
    expect(result.mechanical).toBe(true);
  });

  it("mechanical: true — keyword in first paragraph of body", () => {
    const result = scopeSignal({
      title: "Update classifier",
      body: "This is a one-line change to the return type.",
    });
    expect(result.mechanical).toBe(true);
  });

  it("mechanical: false — keyword only appears after first ## heading", () => {
    const body = [
      "Update the classifier behavior.",
      "",
      "## Details",
      "This is a rename of the internal helper only.",
    ].join("\n");
    const result = scopeSignal({ title: "Update classifier", body });
    expect(result.mechanical).toBe(false);
  });

  it("mechanical: true — Fix path section with named function", () => {
    const body = [
      "The classifier returns the wrong tier.",
      "",
      "## Acceptance criteria",
      "- [ ] Tier is correct",
      "- [ ] Tests pass",
      "",
      "## Fix path:",
      "Update `classifyTier`'s return value when label matches.",
    ].join("\n");
    const result = scopeSignal({ title: "Fix classifier", body });
    expect(result.mechanical).toBe(true);
  });

  it("mechanical: false — no keywords, no Fix path section", () => {
    const body = [
      "We need to improve the overall system behavior.",
      "",
      "## Acceptance criteria",
      "- [ ] System works better",
      "- [ ] Tests pass",
    ].join("\n");
    const result = scopeSignal({ title: "Improve system behavior", body });
    expect(result.mechanical).toBe(false);
  });

  // ── combination ──────────────────────────────────────────────────────────

  it("downgrade: true — all three signals present", () => {
    const body = [
      "rename the exportTier helper in classify.ts and src/index.ts",
      "",
      "## Acceptance criteria",
      "- [ ] All callers updated",
      "- [ ] Tests pass",
    ].join("\n");
    const result = scopeSignal({ title: "rename exportTier helper", body });
    expect(result.small).toBe(true);
    expect(result.locked).toBe(true);
    expect(result.mechanical).toBe(true);
    expect(result.downgrade).toBe(true);
    expect(result.reasons.length).toBe(3);
  });

  it("downgrade: false — two of three present (small + locked, no mechanical)", () => {
    const body = [
      "Update the system behavior in classify.ts and index.ts",
      "",
      "## Acceptance criteria",
      "- [ ] System works",
      "- [ ] Tests pass",
    ].join("\n");
    const result = scopeSignal({ title: "Improve classifier", body });
    expect(result.small).toBe(true);
    expect(result.locked).toBe(true);
    expect(result.mechanical).toBe(false);
    expect(result.downgrade).toBe(false);
  });

  it("downgrade: false — body is undefined", () => {
    const result = scopeSignal({ title: "rename the foo function", body: undefined });
    // small is false (no body), so downgrade cannot fire even with mechanical keyword in title
    expect(result.small).toBe(false);
    expect(result.downgrade).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyTier + scope downgrade integration
// ---------------------------------------------------------------------------

describe("classifyTier + scope downgrade", () => {
  // Build a well-specified body with exactly N file refs.
  const makeBody = (fileCount: number, mechanical = true): string => {
    const files = Array.from({ length: fileCount }, (_, i) => `src/file${i}.ts`).join(", ");
    const firstPara = mechanical
      ? `This is a rename of the helper. Affected files: ${files}`
      : `Update the affected files: ${files}`;
    return [
      firstPara,
      "",
      "## Acceptance criteria",
      "- [ ] All callers updated",
      "- [ ] Tests pass",
      "- [ ] No lint errors",
    ].join("\n");
  };

  it("type:refactor label + all scope signals → tier2 (downgraded)", () => {
    const result = classifyTier({
      title: "rename the exportTier helper",
      body: makeBody(2, true),
      labels: ["type:refactor"],
    });
    expect(result.tier).toBe("tier2");
    expect(result.reason).toMatch(/scope signal/);
  });

  it("type:refactor label + 4 files (not small) → tier1 (no downgrade)", () => {
    const result = classifyTier({
      title: "rename the exportTier helper",
      body: makeBody(4, true),
      labels: ["type:refactor"],
    });
    expect(result.tier).toBe("tier1");
  });

  it("keyword-resolved tier1 + all scope signals → tier2 (downgrade applies on keyword path too)", () => {
    const result = classifyTier({
      title: "refactor the rename helper",
      body: makeBody(2, true),
      labels: ["area:backend"],
    });
    expect(result.tier).toBe("tier2");
    expect(result.reason).toMatch(/scope signal/);
  });

  it("type:refactor + scope signals but only 1 AC bullet → tier1 (locked false)", () => {
    const body = [
      "rename the helper in classify.ts and src/index.ts",
      "",
      "## Acceptance criteria",
      "- [ ] Tests pass",
    ].join("\n");
    const result = classifyTier({
      title: "rename the helper",
      body,
      labels: ["type:refactor"],
    });
    expect(result.tier).toBe("tier1");
  });

  it("existing tests still pass — type:bug → tier2 regardless of scope signals", () => {
    const result = classifyTier({
      title: "rename and fix something",
      body: makeBody(1, true),
      labels: ["type:bug"],
    });
    expect(result.tier).toBe("tier2");
    expect(result.reason).toMatch(/type:bug/);
  });
});
