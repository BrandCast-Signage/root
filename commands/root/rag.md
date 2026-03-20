# /root:rag — RAG Database Management

Manage the RAG database that powers doc-aware context in Root.

Parse the first word of the argument to determine the action. Default to `status` if no argument.

## `status` (default)

Show the current state of the RAG database.

1. Call `mcp__plugin_root_local-rag__status`
2. Read `root.config.json` → `ingest` section
3. Output a concise summary:
   ```
   RAG Database:
     Documents: 486 | Chunks: 19,041 | Search: hybrid
     Directories: docs/dev, apps/backend, packages (5 total)
     DB path: .root/rag-db (from root.config.json)
   ```

## `ingest`

Ingest docs into the RAG database from `root.config.json`.

1. Read `root.config.json` → `ingest.include`, `ingest.exclude`, `ingest.extensions`
2. If no config exists, tell the user to run `/root:init` first and stop
3. Use Bash to call the mcp-local-rag CLI for each include directory:
   ```bash
   RAG_BIN="${HOME}/.root-framework/mcp/node_modules/mcp-local-rag/dist/index.js"
   DB_PATH=$(python3 -c "import json; print(json.load(open('root.config.json')).get('ingest', {}).get('dbPath', '.root/rag-db'))" 2>/dev/null || echo ".root/rag-db")
   node "$RAG_BIN" ingest --db-path "$DB_PATH" --cache-dir "${HOME}/.cache/mcp-local-rag/models" <directory>
   ```
4. Report results:
   > Ingested **234 files** into RAG.

## `refresh`

Clear all embeddings and re-ingest everything. Use after major doc changes.

1. Call `mcp__plugin_root_local-rag__list_files` to get all indexed files
2. Call `mcp__plugin_root_local-rag__delete_file` for each file
3. Run the `ingest` action
4. Report: > Cleared **486 docs**. Re-ingested **490 files**.

## `clear`

Delete all embeddings.

1. Call `mcp__plugin_root_local-rag__list_files` to get all indexed files
2. Call `mcp__plugin_root_local-rag__delete_file` for each file
3. Report: > Cleared **486 docs**. Run `/root:rag ingest` to re-populate.

## `config`

Show what's being indexed and how to change it.

1. Read `root.config.json` → `ingest` section
2. Call `mcp__plugin_root_local-rag__list_files` to get what's currently indexed
3. Count files on disk matching the include/exclude/extensions rules (use Glob)
4. Show:
   ```
   RAG Config (root.config.json → ingest):

   Include: docs/dev, apps/backend, apps/brandcast-frontend, packages
   Exclude: **/node_modules/**, **/dist/**, **/_archive/**
   Extensions: .md

   On disk: 556 matching files
   In RAG:  486 indexed documents
   Delta:   70 files not yet ingested

   To modify: edit root.config.json → ingest section
   To apply:  /root:rag refresh
   To discover new directories: /root:rag scan
   ```

## `scan`

Scan the project for directories worth indexing that aren't currently included.

1. Read `root.config.json` → `ingest.include` to get currently included directories
2. Use Bash to list all top-level directories, excluding obvious noise:
   - Skip: `node_modules`, `.git`, `dist`, `build`, `.next`, `.claude`, `.gemini`, `coverage`, `__pycache__`, `.venv`, `target`, `vendor`, `.cache`, `.turbo`
3. For each directory NOT already in `include`:
   - Count `.md` files (respecting exclude patterns)
   - Skip directories with 0 matching files
4. Present results using AskUserQuestion with multiSelect:
   - Show each candidate directory with its file count
   - Pre-select directories with 5+ files
   - Options like: `ops/ (12 .md files)`, `e2e-tests/ (3 .md files)`
5. On selection:
   - Read `root.config.json`, add selected directories to `ingest.include`
   - Write the updated config back using the Edit tool
   - Run the `ingest` action for the newly added directories only
   - Report: > Added **ops/**, **e2e-tests/** to config. Ingested **15 files**.
