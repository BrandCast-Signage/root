# /root:rag — RAG Database Management

Manage the RAG database that powers doc-aware context in Root.

Parse the first word of the argument to determine the action. Default to `status` if no argument.

## Shared Setup

All subcommands below use these variables. Set them first:

```bash
RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
CACHE_DIR="${HOME}/.cache/mcp-local-rag/models"
```

## `status` (default)

Show the current state of the RAG database.

1. Run the shared setup, then:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" status
   ```
2. Read `root.config.json` → `ingest` section
3. Output a concise summary:
   ```
   RAG Database:
     Documents: 486 | Chunks: 19,041 | Search: hybrid
     Docs directories: docs/ (all files)
     Source files: apps/*/README.md, packages/*/README.md
     DB path: .root/rag-db (from root.config.json)
   ```

## `ingest`

Ingest into the RAG database from `root.config.json`.

1. Read `root.config.json` → `ingest.docs` and `ingest.sources`
2. If no config exists, tell the user to run `/root:init` first and stop
3. Run the shared setup, then:
   - For each directory in `docs`, ingest the entire directory:
     ```bash
     node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <directory>
     ```
   - For each glob pattern in `sources`, expand the pattern using Glob, then ingest each matched file:
     ```bash
     node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" ingest <file>
     ```
4. Report results:
   > Ingested **234 docs** + **12 source files** into RAG.

## `refresh`

Clear all embeddings and re-ingest everything. Use after major doc changes.

1. Run the shared setup, then list all indexed files:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" list
   ```
2. Delete each file:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" delete <filepath>
   ```
3. Run the `ingest` action
4. Report: > Cleared **486 docs**. Re-ingested **490 files**.

## `clear`

Delete all embeddings.

1. Run the shared setup, then list all indexed files:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" list
   ```
2. Delete each file:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" delete <filepath>
   ```
3. Report: > Cleared **486 docs**. Run `/root:rag ingest` to re-populate.

## `config`

Show what's being indexed and how to change it.

1. Read `root.config.json` → `ingest` section
2. Run the shared setup, then list indexed files:
   ```bash
   node "$RAG_BIN" --db-path "$DB_PATH" --cache-dir "$CACHE_DIR" list
   ```
3. Count files on disk matching docs directories and source patterns (use Glob)
4. Show:
   ```
   RAG Config (root.config.json → ingest):

   Docs (full directories): docs/
   Sources (specific files): apps/*/README.md, packages/*/README.md

   On disk: 256 docs + 12 source files
   In RAG:  250 indexed documents
   Delta:   18 files not yet ingested

   To modify: edit root.config.json → ingest section
   To apply:  /root:rag refresh
   To discover new directories: /root:rag scan
   ```

## `scan`

Scan the project for directories worth indexing that aren't currently included.

1. Read `root.config.json` → `ingest.docs` to get currently included doc directories
2. Use Bash to list all top-level directories, excluding obvious noise:
   - Skip: `node_modules`, `.git`, `dist`, `build`, `.next`, `.claude`, `.gemini`, `coverage`, `__pycache__`, `.venv`, `target`, `vendor`, `.cache`, `.turbo`
3. For each directory NOT already in `docs`:
   - Count `.md` files
   - Skip directories with 0 matching files
4. Present results using AskUserQuestion with multiSelect:
   - Show each candidate directory with its file count
   - Pre-select directories with 5+ files
   - Options like: `ops/ (12 .md files)`, `e2e-tests/ (3 .md files)`
5. On selection:
   - Read `root.config.json`, add selected directories to `ingest.docs`
   - Write the updated config back using the Edit tool
   - Run the `ingest` action for the newly added directories only
   - Report: > Added **ops/**, **e2e-tests/** to docs. Ingested **15 files**.
