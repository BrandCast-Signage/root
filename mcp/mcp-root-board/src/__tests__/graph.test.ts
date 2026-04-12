import {
  analyzeGraph,
  extractMermaidBlock,
  findSubgraphs,
  parseMermaidGraph,
} from "../graph.js";

// ---------------------------------------------------------------------------
// parseMermaidGraph — inline node definitions in edges
// ---------------------------------------------------------------------------

describe("parseMermaidGraph — inline node definitions", () => {
  it("parses nodes defined only as part of edge lines", () => {
    const input = `graph TD
    A1["#1: types"] --> A2["#2: service"]`;
    const { nodes, edges } = parseMermaidGraph(input);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["A1", "A2"]);
    expect(nodes.find((n) => n.id === "A1")?.label).toBe("#1: types");
    expect(nodes.find((n) => n.id === "A2")?.label).toBe("#2: service");
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: "A1", to: "A2", hard: true });
  });

  it("deduplicates nodes referenced multiple times", () => {
    const input = `graph TD
    A1["#1: types"] --> A2["#2: service"]
    A2 --> A3["#3: route"]`;
    const { nodes } = parseMermaidGraph(input);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["A1", "A2", "A3"]);
  });

  it("parses without the graph TD line", () => {
    const input = `A1["#1: types"] --> A2["#2: service"]`;
    const { nodes, edges } = parseMermaidGraph(input);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0].hard).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// analyzeGraph — single connected component
// ---------------------------------------------------------------------------

describe("analyzeGraph — single connected component", () => {
  it("produces 1 subgraph with groups A and B; shouldDecompose = false", () => {
    const input = `graph TD
    A1["#1: types"] --> A2["#2: service"]
    A2 --> A3["#3: route"]
    A1 --> B4["#4: frontend"]`;

    const result = analyzeGraph(input);
    expect(result.subgraphs).toHaveLength(1);
    expect(result.shouldDecompose).toBe(false);

    const groups = result.subgraphs[0].groups;
    expect(groups).toContain("A");
    expect(groups).toContain("B");

    const nodeIds = result.subgraphs[0].nodeIds.sort();
    expect(nodeIds).toEqual(["A1", "A2", "A3", "B4"]);
  });
});

// ---------------------------------------------------------------------------
// analyzeGraph — two disconnected components
// ---------------------------------------------------------------------------

describe("analyzeGraph — two disconnected components", () => {
  it("produces 2 subgraphs; shouldDecompose = true", () => {
    const input = `graph TD
    A1["#1: types"] --> A2["#2: service"]
    A2 --> A3["#3: route"]
    B4["#4: notifications"] --> B5["#5: templates"]`;

    const result = analyzeGraph(input);
    expect(result.subgraphs).toHaveLength(2);
    expect(result.shouldDecompose).toBe(true);

    const subA = result.subgraphs.find((s) => s.groups.includes("A"));
    const subB = result.subgraphs.find((s) => s.groups.includes("B"));

    expect(subA).toBeDefined();
    expect(subA!.nodeIds.sort()).toEqual(["A1", "A2", "A3"]);
    expect(subA!.groups).toEqual(["A"]);

    expect(subB).toBeDefined();
    expect(subB!.nodeIds.sort()).toEqual(["B4", "B5"]);
    expect(subB!.groups).toEqual(["B"]);
  });
});

// ---------------------------------------------------------------------------
// analyzeGraph — soft edge doesn't connect components
// ---------------------------------------------------------------------------

describe("analyzeGraph — soft edge doesn't connect components", () => {
  it("treats soft edge as non-connecting; produces 2 subgraphs", () => {
    const input = `graph TD
    A1["#1: types"] --> A2["#2: service"]
    B3["#3: frontend"] --> B4["#4: styles"]
    A2 -.-> B3`;

    const result = analyzeGraph(input);
    expect(result.subgraphs).toHaveLength(2);
    expect(result.shouldDecompose).toBe(true);

    // Confirm the soft edge was recorded but not as hard
    const softEdge = result.edges.find(
      (e) => e.from === "A2" && e.to === "B3"
    );
    expect(softEdge).toBeDefined();
    expect(softEdge!.hard).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzeGraph — three disconnected components
// ---------------------------------------------------------------------------

describe("analyzeGraph — three disconnected components", () => {
  it("produces 3 subgraphs; shouldDecompose = true", () => {
    const input = `graph TD
    A1["#1: api"] --> A2["#2: handler"]
    B3["#3: ui"] --> B4["#4: form"]
    C5["#5: migration"]`;

    const result = analyzeGraph(input);
    expect(result.subgraphs).toHaveLength(3);
    expect(result.shouldDecompose).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// analyzeGraph — single node
// ---------------------------------------------------------------------------

describe("analyzeGraph — single node", () => {
  it("produces 1 subgraph; shouldDecompose = false", () => {
    const input = `graph TD
    A1["#1: fix"]`;

    const result = analyzeGraph(input);
    expect(result.subgraphs).toHaveLength(1);
    expect(result.shouldDecompose).toBe(false);
    expect(result.subgraphs[0].nodeIds).toEqual(["A1"]);
  });
});

// ---------------------------------------------------------------------------
// extractMermaidBlock
// ---------------------------------------------------------------------------

describe("extractMermaidBlock", () => {
  it("extracts content of the first mermaid block from markdown", () => {
    const markdown = `# Implementation Plan

Some text here.

\`\`\`mermaid
graph TD
    A1["#1: types"] --> A2["#2: service"]
\`\`\`

More text.`;

    const result = extractMermaidBlock(markdown);
    expect(result).not.toBeNull();
    expect(result).toContain("graph TD");
    expect(result).toContain("A1");
  });

  it("returns null when no mermaid block is present", () => {
    const markdown = `# No Diagrams Here

Just some text.

\`\`\`typescript
const x = 1;
\`\`\``;

    const result = extractMermaidBlock(markdown);
    expect(result).toBeNull();
  });

  it("extracts only the first mermaid block when multiple exist", () => {
    const markdown = `\`\`\`mermaid
graph TD
    A1 --> A2
\`\`\`

\`\`\`mermaid
graph TD
    B1 --> B2
\`\`\``;

    const result = extractMermaidBlock(markdown);
    expect(result).not.toBeNull();
    expect(result).toContain("A1");
    expect(result).not.toContain("B1");
  });
});

// ---------------------------------------------------------------------------
// findSubgraphs — group derivation
// ---------------------------------------------------------------------------

describe("findSubgraphs — group derivation", () => {
  it("correctly derives group letters from node IDs", () => {
    const { nodes, edges } = parseMermaidGraph(`graph TD
    A1["#1: a"] --> B2["#2: b"]`);
    const subgraphs = findSubgraphs(nodes, edges);
    expect(subgraphs).toHaveLength(1);
    expect(subgraphs[0].groups.sort()).toEqual(["A", "B"]);
  });

  it("returns empty array when no nodes", () => {
    const subgraphs = findSubgraphs([], []);
    expect(subgraphs).toEqual([]);
  });
});
