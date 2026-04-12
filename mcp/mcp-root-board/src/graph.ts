/** A node in the dependency graph, representing a Change Manifest entry. */
export interface GraphNode {
  /** The node ID from the Mermaid graph (e.g., "A1", "B4"). */
  id: string;
  /** The label text (e.g., "#1: types"). */
  label: string;
  /** The execution group letter, derived from the first character of the ID. */
  group: string;
}

/** A directed edge in the dependency graph. */
export interface GraphEdge {
  /** Source node ID. */
  from: string;
  /** Target node ID. */
  to: string;
  /** Whether this is a hard dependency (true) or soft dependency (false). */
  hard: boolean;
}

/** A disconnected subgraph — a set of nodes with no hard edges to nodes outside the set. */
export interface Subgraph {
  /** Node IDs in this subgraph. */
  nodeIds: string[];
  /** Execution group letters present in this subgraph (deduplicated). */
  groups: string[];
  /** The nodes themselves. */
  nodes: GraphNode[];
}

/** Result of parsing and analyzing a dependency graph. */
export interface GraphAnalysis {
  /** All nodes found in the graph. */
  nodes: GraphNode[];
  /** All edges found in the graph. */
  edges: GraphEdge[];
  /** Disconnected subgraphs (connected components via hard edges only). */
  subgraphs: Subgraph[];
  /** Whether decomposition is indicated (2+ disconnected subgraphs). */
  shouldDecompose: boolean;
}

/**
 * Derive the group letter from a node ID.
 * If the ID starts with a letter followed by a digit (e.g., "A1", "B4"), the group is the letter.
 * If the ID is just a letter, the group is that letter.
 * Otherwise, use the first character.
 */
function deriveGroup(id: string): string {
  return id.charAt(0).toUpperCase();
}

/**
 * Parse a Mermaid DAG block and extract nodes and edges.
 *
 * The input may or may not include the `graph TD` line.
 * Node format: `ID["label"]` or just `ID` (bare).
 * Hard edge: `-->`
 * Soft edge: `.->` or `-.->` or `-.->`
 */
export function parseMermaidGraph(
  mermaid: string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  /**
   * Upsert a node into nodeMap. If a label is provided and the node is new
   * (or was previously inserted without a label), update it.
   */
  function upsertNode(id: string, label?: string): void {
    const existing = nodeMap.get(id);
    const resolvedLabel = label ?? id;
    if (!existing) {
      nodeMap.set(id, { id, label: resolvedLabel, group: deriveGroup(id) });
    } else if (label !== undefined) {
      // Update label if we now have a real one
      nodeMap.set(id, { ...existing, label });
    }
  }

  /**
   * Parse a node token which may be `ID["label"]`, `ID['label']`, or bare `ID`.
   * Returns { id, label } where label may be undefined for bare IDs.
   */
  function parseNodeToken(token: string): { id: string; label: string | undefined } {
    // Match ID["label"] or ID['label']
    const bracketMatch = token.match(/^([A-Za-z][A-Za-z0-9_]*)(?:\[["'](.+?)["']\])?/);
    if (bracketMatch) {
      return { id: bracketMatch[1], label: bracketMatch[2] };
    }
    return { id: token.trim(), label: undefined };
  }

  const lines = mermaid.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines, graph directive, and subgraph lines
    if (
      !line ||
      /^graph\s+/i.test(line) ||
      /^subgraph\b/i.test(line) ||
      line === "end"
    ) {
      continue;
    }

    // Detect edge type: hard (-->) or soft (-.-> or .-> or -.->)
    // We split on the arrow to get left and right side node tokens.
    // Soft arrow patterns: -.-> or .-> or -.- >
    const softArrowRe = /\s*(?:-\.->|\.->|-\.->\s*)\s*/;
    const hardArrowRe = /\s*-->\s*/;

    if (softArrowRe.test(line)) {
      const parts = line.split(softArrowRe);
      if (parts.length >= 2) {
        const fromToken = parseNodeToken(parts[0].trim());
        const toToken = parseNodeToken(parts[1].trim());
        upsertNode(fromToken.id, fromToken.label);
        upsertNode(toToken.id, toToken.label);
        edges.push({ from: fromToken.id, to: toToken.id, hard: false });
      }
    } else if (hardArrowRe.test(line)) {
      const parts = line.split(hardArrowRe);
      if (parts.length >= 2) {
        const fromToken = parseNodeToken(parts[0].trim());
        const toToken = parseNodeToken(parts[1].trim());
        upsertNode(fromToken.id, fromToken.label);
        upsertNode(toToken.id, toToken.label);
        edges.push({ from: fromToken.id, to: toToken.id, hard: true });
      }
    } else {
      // Standalone node definition: ID["label"] or bare ID
      const token = parseNodeToken(line);
      if (token.id && /^[A-Za-z]/.test(token.id)) {
        upsertNode(token.id, token.label);
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}

/**
 * Find disconnected subgraphs (connected components) using hard edges only.
 * Uses BFS from each unvisited node to build connected components.
 * Returns subgraphs sorted by the first group letter in each.
 */
export function findSubgraphs(nodes: GraphNode[], edges: GraphEdge[]): Subgraph[] {
  if (nodes.length === 0) {
    return [];
  }

  // Build an undirected adjacency list from hard edges only
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set<string>());
  }
  for (const edge of edges) {
    if (!edge.hard) {
      continue;
    }
    // Ensure keys exist (handles nodes referenced only in edges)
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, new Set<string>());
    }
    if (!adjacency.has(edge.to)) {
      adjacency.set(edge.to, new Set<string>());
    }
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) {
      continue;
    }

    // BFS from this node
    const component: string[] = [];
    const queue: string[] = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = adjacency.get(current) ?? new Set<string>();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  // Build a node lookup map
  const nodeById = new Map<string, GraphNode>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  // Convert components to Subgraph objects
  const subgraphs: Subgraph[] = components.map((nodeIds) => {
    const subNodes = nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => n !== undefined);

    const groupSet = new Set<string>();
    for (const n of subNodes) {
      groupSet.add(n.group);
    }
    const groups = Array.from(groupSet).sort();

    return { nodeIds, groups, nodes: subNodes };
  });

  // Sort by first group letter of each subgraph
  subgraphs.sort((a, b) => {
    const ag = a.groups[0] ?? "";
    const bg = b.groups[0] ?? "";
    return ag.localeCompare(bg);
  });

  return subgraphs;
}

/**
 * Parse a Mermaid graph and analyze its connected components.
 * This is the main entry point for graph analysis.
 */
export function analyzeGraph(mermaid: string): GraphAnalysis {
  const { nodes, edges } = parseMermaidGraph(mermaid);
  const subgraphs = findSubgraphs(nodes, edges);
  return {
    nodes,
    edges,
    subgraphs,
    shouldDecompose: subgraphs.length > 1,
  };
}

/**
 * Extract the content of the first ```mermaid code block from a markdown document.
 * Returns the block content (without the fences), or null if not found.
 */
export function extractMermaidBlock(markdown: string): string | null {
  const match = markdown.match(/```mermaid\r?\n([\s\S]*?)```/);
  if (!match) {
    return null;
  }
  return match[1];
}
