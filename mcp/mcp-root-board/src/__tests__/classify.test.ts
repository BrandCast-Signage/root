import { classifyTier } from "../classify.js";

describe("classifyTier", () => {
  describe("label precedence", () => {
    it("type:feature → tier1", () => {
      const result = classifyTier({ title: "anything", labels: ["type:feature"] });
      expect(result.tier).toBe("tier1");
      expect(result.reason).toMatch(/type:feature/);
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
      const result = classifyTier({ title: "x", labels: ["TYPE:Feature"] });
      expect(result.tier).toBe("tier1");
    });

    it("first matching type label wins — tier1 before tier2", () => {
      const result = classifyTier({
        title: "x",
        labels: ["type:feature", "type:bug"],
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
