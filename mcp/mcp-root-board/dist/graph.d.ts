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
 * Parse a Mermaid DAG block and extract nodes and edges.
 *
 * The input may or may not include the `graph TD` line.
 * Node format: `ID["label"]` or just `ID` (bare).
 * Hard edge: `-->`
 * Soft edge: `.->` or `-.->` or `-.->`
 */
export declare function parseMermaidGraph(mermaid: string): {
    nodes: GraphNode[];
    edges: GraphEdge[];
};
/**
 * Find disconnected subgraphs (connected components) using hard edges only.
 * Uses BFS from each unvisited node to build connected components.
 * Returns subgraphs sorted by the first group letter in each.
 */
export declare function findSubgraphs(nodes: GraphNode[], edges: GraphEdge[]): Subgraph[];
/**
 * Parse a Mermaid graph and analyze its connected components.
 * This is the main entry point for graph analysis.
 */
export declare function analyzeGraph(mermaid: string): GraphAnalysis;
/**
 * Extract the content of the first ```mermaid code block from a markdown document.
 * Returns the block content (without the fences), or null if not found.
 */
export declare function extractMermaidBlock(markdown: string): string | null;
