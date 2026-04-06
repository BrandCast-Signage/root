# /root:explore — Codebase Exploration

Explore and investigate a codebase using RAG-powered discovery. This command is for open-ended understanding — no edits, no commits, no PRs. Just research.

Parse the first word of the argument to determine the action. Default to `topic` if no argument or if the argument doesn't match a subcommand.

## Shared Setup

All subcommands use these variables. Set them first:

```bash
RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"
```

## `topic <query>` (default)

Open-ended exploration of a topic area. Use when the user wants to understand how something works, what touches a concept, or where to start looking.

### Discovery Loop (3-4 rounds)

**Round 1 — RAG seed:**
1. Query the RAG database with the user's topic, using broad contextual terms:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" query "<topic with contextual synonyms>"
   ```
2. Read the top 3-5 results (score < 0.5). Extract:
   - File paths mentioned in the docs
   - Component/service/module names
   - Function and type names
   - Related concepts not in the original query

**Round 2 — Source verification:**
1. For each key file path found in Round 1, read the actual source file
2. Use Grep to find imports, exports, and references to the identified components
3. Extract new terms: function signatures, type names, config keys, route paths, database tables
4. Note discrepancies between docs and source (stale docs, missing docs)

**Round 3 — Dependency tracing:**
1. Query RAG again with terms discovered in Round 2 that weren't in the original query
2. Use Grep to trace who imports/calls the key components found so far
3. Use Grep to trace what the key components depend on
4. Build the dependency picture: what does this area need, and what needs this area

**Round 4 — Gap filling (if needed):**
1. If open questions remain, run targeted Grep searches for specific patterns
2. If a component's behavior is unclear, read its test files for usage examples
3. If configuration is involved, search for env vars, config keys, or feature flags

### Output Format

```
## Exploration: <topic>

### Key Components
- <path> — <one-line description of role>
- <path> — <one-line description of role>
...

### How It Works
<2-4 paragraphs explaining the system/flow in plain language, grounded in what was actually found in source code. Reference specific files and line numbers.>

### Dependencies
Depends on: <list of components/services this area imports or calls>
Depended on by: <list of components/services that import or call this area>

### Key Files
| File | Role | Notable |
|------|------|---------|
| <path> | <role> | <anything surprising or important> |

### Doc Coverage
- <n> docs found covering this area
- <list any gaps: components with no docs, stale docs, docs that contradict source>

### Open Questions
- <things that remain unclear after exploration>
- <areas that would need deeper investigation>
```

After producing the output, use AskUserQuestion:
- **"Save as research doc"** — write findings to `<docsDir>/research/<topic-slug>.md` with frontmatter (type: research, status: draft) and ingest into RAG
- **"Explore deeper"** — ask what area to drill into, then run another discovery loop focused on that area
- **"Done"** — end

## `flow <entry-point>`

Trace data or control flow through the system starting from a specific file, function, endpoint, or event.

The `<entry-point>` can be:
- A file path: `src/services/auth.ts`
- A function name: `processPayment`
- An endpoint: `POST /api/orders`
- An event/signal: `user.created` or `ORDER_COMPLETED`

### Tracing Process

**Step 1 — Locate the entry point:**
1. If it's a file path, read it directly
2. If it's a function/endpoint/event, query RAG first, then Grep to find the definition:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" query "<entry-point> definition handler"
   ```
3. Read the source file containing the entry point

**Step 2 — Trace forward (what does it trigger):**
1. From the entry point, follow the call chain:
   - Read function bodies, noting every external call (service method, DB query, API call, event emit, queue push)
   - For each external call, read that target's source
   - Continue 3-4 levels deep or until the chain terminates (DB write, HTTP response, event emit with no handler)
2. Track side effects at each step: DB writes, cache mutations, events emitted, external API calls, logs

**Step 3 — Trace backward (what triggers it):**
1. Use Grep to find all callers/references to the entry point
2. For endpoints: search for route registration and any middleware chain
3. For functions: search for import statements and direct calls
4. For events: search for event subscriptions and emitters

**Step 4 — RAG enrichment:**
1. Query RAG for each major component in the flow to find related docs
2. Note where docs exist vs where they're missing

### Output Format

```
## Flow Trace: <entry-point>

### Trigger
<what initiates this flow — HTTP request, cron job, event, user action>

### Flow Diagram
```
<step 1> → <step 2> → <step 3>
                    ↘ <side effect>
           <step 2b> → <step 4>
```

### Step-by-Step
1. **<component>** (<path>:<line>)
   - Receives: <input shape>
   - Does: <what it does>
   - Calls: <next step>
   - Side effects: <DB writes, events, etc.>

2. **<component>** (<path>:<line>)
   ...

### Side Effects
| Step | Type | Target | Description |
|------|------|--------|-------------|
| 1 | DB write | users table | Updates last_login timestamp |
| 3 | Event | user.logged_in | Emitted to event bus |

### Error Paths
- <what happens if step N fails>
- <retry logic, fallback behavior, error propagation>

### Open Questions
- <unclear branch points, undocumented side effects>
```

After output, offer the same three options as `topic`: save, explore deeper, or done.

## `map <area>`

Build a component and dependency map for a subsystem or directory area.

The `<area>` can be:
- A directory: `src/services/`, `packages/auth/`
- A concept: `billing`, `notifications`
- A layer: `middleware`, `data access`

### Mapping Process

**Step 1 — Identify boundaries:**
1. If `<area>` is a directory, use Glob to list all source files in it
2. If `<area>` is a concept, query RAG and Grep to find all related files:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" query "<area> components modules services"
   ```
3. Read each file's exports and imports to determine what's "inside" vs "outside" this area

**Step 2 — Internal structure:**
1. For each file in the area, extract:
   - Exported functions, classes, types, constants
   - Internal imports (within the area)
   - Role: entry point, service, utility, types, config
2. Group files by role/responsibility

**Step 3 — External interfaces:**
1. **Inbound**: Use Grep to find all imports of this area's files from outside the area
2. **Outbound**: Collect all imports from outside the area used by files inside it
3. Categorize external dependencies: framework, library, sibling module, external service

**Step 4 — RAG enrichment:**
1. Query RAG for existing documentation on this area
2. Cross-reference: which components are documented, which aren't

### Output Format

```
## Component Map: <area>

### Overview
<1-2 sentences: what this area does and its role in the system>

### Components
| Component | File | Exports | Role |
|-----------|------|---------|------|
| AuthService | src/services/auth.ts | login, logout, refresh, validateToken | Core auth logic |
| AuthMiddleware | src/middleware/auth.ts | requireAuth, optionalAuth | Route guards |

### Internal Dependencies
<which components in this area depend on each other>
```
AuthMiddleware → AuthService → TokenUtils
                             → SessionStore
```

### External Interface

**Inbound** (what uses this area):
| Consumer | File | Uses |
|----------|------|------|
| OrderRoutes | src/routes/orders.ts | requireAuth middleware |
| UserSettings | src/services/settings.ts | validateToken |

**Outbound** (what this area depends on):
| Dependency | Type | Used By |
|------------|------|---------|
| pg (postgres) | library | SessionStore |
| redis | library | TokenCache |
| user-service | sibling | AuthService |

### Doc Coverage
- Documented: <list>
- Missing docs: <list>
- Stale docs: <list with age>

### Observations
- <architectural notes, patterns, potential concerns>
```

After output, offer the same three options: save, explore deeper, or done.
