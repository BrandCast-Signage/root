# /root:doc-context — Documentation Discovery

Find and load the most relevant developer documentation for a given topic. Use when starting work on a system, debugging an issue, or understanding how something works.

## Protocol

### Step 1: RAG semantic search

1. Use `mcp__plugin_root_local-rag__query_documents` with a query formulated from the topic
   - Include the topic keywords plus contextual terms (e.g., "oauth" → "OAuth token authentication flow")
   - Use `limit: 10` for broad coverage
2. Filter results by score: use < 0.3 directly, consider 0.3-0.5 if contextually relevant, skip > 0.5
3. Identify the top 1-3 unique documents (by filePath) from the results
4. **Fallback**: If RAG is unavailable, read `root.config.json` → `project.docsDir` and fall back to glob/grep search across that directory

### Step 2: Read and report

1. Read the top 1-3 most relevant docs in full
2. For each doc, report:
   - **Path**: relative path from repo root
   - **Title**: from frontmatter or first heading
   - **Relevance**: RAG score and why it matched
   - **Last Updated**: from frontmatter `updated:` field if present
   - **Freshness**: warn if `updated` is > 3 months ago
3. If NO docs found for the topic (all results > 0.5), report this as a **documentation gap**
