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
     DB path: .claude/rag-db/
   ```

## `ingest`

Ingest docs into the RAG database from `root.config.json`.

1. Read `root.config.json` → `ingest.include`, `ingest.exclude`, `ingest.extensions`
2. If no config exists, tell the user to run `/root:init` first and stop
3. Use Bash to call the mcp-local-rag CLI for each include directory:
   ```bash
   RAG_BIN="${HOME}/.claude/plugins/data/root/node_modules/.bin/mcp-local-rag"
   $RAG_BIN ingest --db-path .claude/rag-db --cache-dir "${HOME}/.cache/mcp-local-rag/models" <directory>
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
   ```
