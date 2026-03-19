---
name: doc-context
description: "Find and load relevant developer docs for a topic. Use when you need background on a system before making changes. Examples: /doc-context oauth, /doc-context display rendering, /doc-context stripe"
user-invocable: true
argument: topic - the system, feature, or concept to find docs for (e.g., "oauth", "display rendering", "stripe")
---

# /doc-context — Developer Documentation Discovery

## Purpose

Find and load the most relevant developer documentation for a given topic. Use this when starting work on a system, debugging an issue, or understanding how something works.

## Protocol

### Step 1: RAG semantic search

1. Use `mcp__local-rag__query_documents` with a query formulated from the topic
   - Include the topic keywords plus contextual terms (e.g., "oauth" → "OAuth token authentication flow")
   - Use `limit: 10` for broad coverage
2. Filter results by score: use < 0.3 directly, consider 0.3-0.5 if contextually relevant, skip > 0.5
3. Identify the top 1-3 unique documents (by filePath) from the results
4. **Fallback**: If RAG is unavailable, fall back to glob/grep search across `docs/dev/app/**/*.md`, `docs/dev/guides/**/*.md`, and `docs/dev/architecture/**/*.md`

### Step 2: Read and report

1. Read the top 1-3 most relevant docs in full
2. For each doc, report:
   - **Path**: relative path from repo root
   - **Title**: from frontmatter or first heading
   - **Relevance**: RAG score and why it matched
   - **Last Updated**: from frontmatter `updated:` field if present
   - **Freshness**: warn if `updated` is > 3 months ago
3. If NO docs found for the topic (all results > 0.5), report this as a **documentation gap** and suggest it be added to the Known Documentation Gaps table in `docs/dev/README.md`

### Step 3: Cross-reference

Check if the topic appears in the Known Documentation Gaps table (`docs/dev/README.md`). If so, note that this system is known to be underdocumented.

## Examples

- `/doc-context oauth` → finds AUTH_SYSTEM.md, OAUTH_TOKEN_MANAGEMENT.md, EXTERNAL_SERVICE_REGISTRY.md
- `/doc-context display rendering` → finds DISPLAY_RENDERING_ARCHITECTURE.md, INTEGRATION_RENDERER_INVENTORY.md
- `/doc-context stripe` → finds STRIPE_WEBHOOK_HANDLING.md, chip-stripe-integration.md
- `/doc-context brevo` → finds BREVO_CONTACT_SYNC.md
- `/doc-context middleware` → finds MIDDLEWARE_CHAIN.md
- `/doc-context media upload` → finds MEDIA_STORAGE_PIPELINE.md
- `/doc-context schedule` → finds SCHEDULING_ENGINE.md
- `/doc-context audit` → finds AUDIT_LOGGING.md
- `/doc-context calendar events` → finds EVENT_SYSTEM.md
