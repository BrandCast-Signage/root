# Scion Gaps — Observed from the Root 3.0 Integration Spike

**Audience:** Scion maintainers, Root 3.0 planners.

**Scope:** Fourteen gaps encountered while integrating [Scion](https://github.com/GoogleCloudPlatform/scion) as the execution substrate for the Root framework's 3.0 milestone. Captured from hands-on work on macOS (Apple Silicon) with Docker Desktop, running Claude Code + Gemini CLI harnesses against the [brandcast](https://github.com/BrandCast-Signage/brandcast) monorepo.

**Status at time of writing:** one end-to-end Scion-dispatched issue fix completed (brandcast PR #1487, issue #1482) — the findings below are drawn from that run plus two earlier smoke tests plus source-code diving in `~/Code/scion`.

**Key dates:**
- Initial Scion integration: 2026-04-13
- PR [#66 "feat: add OAuth token auth support for Claude harness"](https://github.com/GoogleCloudPlatform/scion/pull/66) opened by @donovan-yohan, partially addresses gap 1+2

**How to read this:** each gap has a severity, the evidence we hit, a suggested fix, and a column showing what PR #66 does or does not do for it. When Scion issues are filed upstream, they should link back here rather than re-deriving context.

---

## HIGH — silent breakage for external users

Any new user hits these and reads as "Scion is broken" without extensive source-code diving.

### Gap 1 — Claude harness has no OAuth auth path

**Location:** `pkg/harness/claude_code.go:355-374` (pre-#66)

**Evidence:** `ResolveAuth` only handles `ANTHROPIC_API_KEY` and Vertex AI. A Claude Max or Pro subscriber has no way to use their subscription; every dispatch fails with `invalid_rapt` once the container's auto-detected Vertex routing tries to refresh a stale Google OAuth token.

We worked around this by:
1. Extracting the OAuth token from macOS Keychain
2. Merging it with existing `mcpOAuth` state into a Linux-compatible `.credentials.json`
3. Seeding the merged file into the Scion claude template
4. Launching with `--no-auth` to prevent Scion from re-adding Vertex env vars

All four steps were required; omitting any one kept the Vertex path winning.

**Suggested fix:** Add a third resolution path in `ResolveAuth` that detects either:
- Env var `CLAUDE_CODE_OAUTH_TOKEN` on the host, OR
- `claudeAiOauth.accessToken` inside `~/.claude/.credentials.json`

...and propagates it into the container as `CLAUDE_CODE_OAUTH_TOKEN` without any Vertex-related env vars.

**PR #66 status:** ✅ **SOLVED.** PR adds `oauth-token` as a first-class auth method, detects the env var via `GatherAuthWithEnv`, auto-extracts from `~/.claude/.credentials.json` via new `extractClaudeOAuthToken()`, and sits at priority `api-key → oauth-token → vertex`.

---

### Gap 2 — macOS Keychain not propagated

**Location:** `pkg/harness/auth.go` `GatherAuthWithEnv`; nothing in the pipeline looks at Keychain.

**Evidence:** On macOS, Claude Code stores its OAuth token in Keychain (`security find-generic-password -s "Claude Code-credentials"`), not in a file. The `~/.claude/.credentials.json` file on disk only contains MCP OAuth state — not the Claude API token itself. Scion's current file-based auto-detection (even post-#66) misses Keychain-resident tokens entirely on macOS.

**Suggested fix:** Platform-specific extraction hook:
- macOS: call `security find-generic-password -s "Claude Code-credentials" -w` and merge `claudeAiOauth.accessToken`
- Linux: read `~/.claude/.credentials.json` directly (this is what #66 implements)

Could live in `GatherAuthWithEnv` gated on `runtime.GOOS == "darwin"`, or in a pre-start hook that normalizes Keychain → file before the harness code runs.

**PR #66 status:** ⚠️ **partial.** The PR establishes the canonical wire format (`CLAUDE_CODE_OAUTH_TOKEN` env var OR `~/.claude/.credentials.json` `claudeAiOauth.accessToken`), which means Root can solve this entirely in userland with a one-liner:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=$(
  security find-generic-password -s "Claude Code-credentials" -w \
  | jq -r '.claudeAiOauth.accessToken // empty'
)
```

Merits upstream consideration for ergonomics, but no longer blocks.

---

### Gap 3 — Default templates shipped team-internal Vertex routing config — ✅ FIXED UPSTREAM

**Location:** `pkg/harness/claude/embeds/settings.json` and `pkg/harness/gemini/embeds/settings.json` (compiled into the `scion` CLI binary via `//go:embed`, stamped into `~/.scion/templates/` at `scion init` time). **Not** in the harness Dockerfiles under `image-build/`.

**Original evidence:** Claude embed carried a Vertex env block (`CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID=duet01`, `@default` / `@20251001` model suffixes); Gemini embed carried `security.auth.selectedType: "gemini-api-key"`. Both hijacked OAuth silently.

**Current state (verified 2026-04-13 against upstream `main`):**

- Claude embed: only `ANTHROPIC_MODEL: "claude-opus-4-6"` and `ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5"` — bare model names, provider-neutral, harmless.
- Gemini embed: `security.auth: {}` — empty, auto-detection wins.

Cleaned up in upstream commits `ed1f3d44` (`fix: pre-trust workspace and remove @default model suffix in Claude harness (#126)`), `c66f0a29` (`feat: add auth-based env key enforcement, schema enums, and cleanup stale gemini values`), `8933ee10` (`fix: protect env`).

**PR #66 status:** N/A. The original concern — that #66 would be a no-op because the template preempted OAuth — no longer applies. The template is now permissive.

**What this means for `dev/scion/setup.md`:** the Step 4 env-block strip (`python3 -c "d.pop('env', None)"`) and Step 4b Gemini `selectedType` flip are obsolete for a fresh install off current upstream `main`. They remain documented in setup.md for anyone running an older Scion binary.

**Residual concern:** none for current main. If Scion ever reintroduces team-internal defaults, the original suggested fix (split into `team/google` overlay) stands.

---

## MEDIUM — friction with discoverable workarounds

User hits, figures out after reading source, moves on, but scar tissue accumulates across users.

### Gap 4 — No `--prompt-file` flag on `scion start`

**Location:** `cmd/start.go` arg handling

**Evidence:** Scion passes the prompt argument through the shell to the harness via `tmux new-session -s scion <harness> "<prompt>"`. Any prompt containing shell-special characters (backticks, `$`, globs, parentheses) gets interpreted by tmux → zsh command substitution before reaching the harness.

During the brandcast #1482 run, a markdown-formatted envelope with backticks around file paths (\`apps/backend/...\`) triggered zsh to attempt to execute every backtick as a command:
```
zsh:1: permission denied: apps/backend/src/templates/notificationTemplates.ts
zsh:1: command not found: 0xD32F2F
...
```
Lost the full dispatch — Claude Code never received the prompt.

**Suggested fix:** `scion start <name> --prompt-file /path/to/task.md` that:
- Reads the file on the host
- Bind-mounts it into the container at a known path (e.g. `/home/scion/task.md`)
- Launches the harness with a short shell-safe prompt like "Read /home/scion/task.md and execute it."

**PR #66 status:** ❌ not addressed.

---

### Gap 5 — Token refresh is manual

**Location:** Pre-start hooks in `pkg/agent/run.go`

**Evidence:** OAuth tokens rotate within hours. During the brandcast smoke tests we seeded a token at 12:14, which had expired by 14:14 in the same session. The agent returned `401 Invalid authentication credentials`. Scion templates and running agents do not hot-reload credentials; they must be re-seeded and agents restarted.

**Suggested fix:** Pre-start hook primitive that runs a configured host-side script before each agent launch. The script can refresh credentials from Keychain, a password manager, a token broker, etc. and write to the canonical wire format (`~/.claude/.credentials.json` or env var). Would integrate cleanly with the Hub's file-secret overlay mechanism.

**PR #66 status:** ⚠️ **materially simpler.** PR #66 re-reads the credentials file on every `scion start`, so the friction collapses from "extract + merge + fanout to N grove templates + restart" to "refresh `~/.claude/.credentials.json` before next dispatch." An explicit pre-start hook is still the right long-term primitive, but userland scripts now suffice.

---

### Gap 6 — No `--auth <method>` flag

**Location:** `cmd/start.go` flags

**Evidence:** If host has gcloud ADC + `GOOGLE_CLOUD_PROJECT` + region all present (common on GCP-flavored developer machines, including anyone with `gcloud auth application-default login` in history), Scion's auto-detection picks Vertex. There's no surgical way to opt out — only `--no-auth`, which disables the entire propagation pipeline.

**Suggested fix:** `scion start <name> --auth <api-key|oauth-token|vertex|auto>` that either:
- Selects the specified method from available credentials
- Fails loudly if the selected method has no available credentials

Lets users express intent without the `--no-auth` cudgel.

**PR #66 status:** ✅ **indirectly solved.** PR #66 plumbs `oauth-token` through `auth_selectedType` in scion-agent.yaml. Set `auth_selectedType: oauth-token` at the template or grove level and the existing explicit-auth path picks it.

A CLI flag is still cleaner UX, but it's no longer the blocker it was.

---

### Gap 7 — Build script forces docker-container buildx driver

**Location:** `image-build/scripts/build-images.sh` `ensure_builder()` function, ~line 110

**Evidence:** The script creates a `docker-container` buildx builder for multi-platform support. On single-arch local builds, this driver's isolation from the host Docker daemon causes intermediate images loaded via `--load` to be invisible to subsequent `FROM` resolution — each stage fails with `pull access denied: scion-base:latest` because the builder can't reach the local daemon cache.

We patched `ensure_builder()` locally to use the active docker-driver builder (`desktop-linux` or `default`) instead. Branch: `root/local-docker-driver` in our Scion clone.

**Suggested fix:** Add a `--driver docker|docker-container|auto` flag to `build-images.sh`. Default `auto` (current behavior). `--driver docker` forces the active daemon-backed builder for local single-arch work.

**PR #66 status:** ❌ not addressed (out of scope for that PR).

---

### Gap 8 — Grove templates drift from global templates

**Location:** `pkg/config/templates.go` copy logic around `CopyDir`

**Evidence:** `scion init` in a repo copies the global template into `.scion/templates/<harness>/`, and grove-local takes precedence forever. Updates to the global template (e.g., re-seeding credentials) don't propagate to existing groves.

We hit this multiple times: credentials seeded into the global template weren't present in already-initialized groves, requiring manual per-grove re-seeding.

**Suggested fix:** Either:
- **`scion grove refresh-templates` command** that pulls updates from global, preserving grove-local deltas
- **Overlay model** where grove templates are deltas on top of global, not full copies — so global updates land automatically unless overridden

**PR #66 status:** ❌ not addressed.

---

## LOW — specific workflows (but Root 3.0 needs most of them)

### Gap 9 — No `gh` CLI / SSH key propagation

**Evidence:** Container has no `gh auth` state and no SSH keys. Agents cannot push branches, open PRs, or fetch from private remotes. Every Root 3.0 autonomous run must fall back to human-in-loop for the PR creation phase (Step 10b of `/root:impl`).

**Revised understanding (post-source-dive):** this is not a missing primitive — three propagation mechanisms already exist:

1. **`volumes:` in `settings.yaml`** (`HarnessConfigEntry.Volumes []api.VolumeMount` at `pkg/config/settings_v1.go:539`, rendered as `-v` bind-mounts by `pkg/runtime/common.go:209-240`). Config-driven, local, no Hub needed. Works today for `~/.ssh/id_ed25519 → /home/scion/.ssh/id_ed25519`.
2. **Template `home/` auto-copy** (`pkg/agent/provision.go:493-506`) — files dropped into `<template>/home/.ssh/id_ed25519` propagate to every agent.
3. **Hub file-secrets** (`scion hub secret set --type file --target ... @~/path`) — fully functional via `writeFileSecrets` in `pkg/runtime/common.go:607-682`, but requires a Hub.

**Suggested fix:** no new ssh-specific primitive; the cleaner upstream ask is to make mechanism #3 work without a Hub (covered under gap 10). Near-term, Root consumers use mechanism #1.

**PR #66 status:** N/A — not an auth-resolution problem.

**Root 3.0 impact:** HIGH for autonomous PR flow, but unblocked via existing `volumes:` pending the cleaner mechanism.

---

### Gap 10 — No local (no-Hub) host-path projection into file secrets

**Evidence:** Real work on brandcast requires kubeconfig, AWS credentials, Stripe keys, Zoho OAuth tokens, database URLs. The original framing was "Scion has no opinionated spec for mounting host paths" — but source review shows the file-secrets pipeline is already built and wired; it just gates on a Hub.

**What already exists (pipeline complete, end-to-end):**

- `api.ResolvedSecret{Type, Target, Value}` at `pkg/api/types.go:494-501` — `Type: file` with base64 `Value` and container `Target`
- `api.RequiredSecret{Key, Type, Target}` at `pkg/api/types.go:472-482` — declaration shape on `HarnessConfigEntry.Secrets` / `V1ProfileConfig.Secrets`
- `writeFileSecrets` at `pkg/runtime/common.go:607-682` — stages files on host, creates parent dirs, emits `host:container:ro` mount specs
- Plumbed through all three runtimes: `docker.go:53`, `podman.go:131`, `apple_container.go:53`
- `scion hub secret set --type file --target /home/scion/.ssh/id_rsa SSH_KEY @~/.ssh/id_rsa` at `cmd/hub_secret.go:105` works today

**What's missing:** `RequiredSecret` has no `HostPath` field — resolution routes through a Hub, not the local filesystem.

**Suggested fix (narrow, additive):**

1. Add a `HostPath` field to a new local `SecretMount` type (or extend `RequiredSecret`) in `pkg/config/settings_v1.go`
2. Resolve it in `pkg/agent/run.go` near line 815, before `opts.ResolvedSecrets` assembly, by reading the host file and wrapping as `ResolvedSecret{Type: file, Target, Value: base64(contents)}`
3. Inject into `runCfg.ResolvedSecrets` — `writeFileSecrets` and the runtime layer handle everything downstream, unchanged

Example `settings.yaml` shape:

```yaml
harness_configs:
  claude:
    secrets:
      - key: ssh_key
        type: file
        host_path: ~/.ssh/id_ed25519
        target: /home/scion/.ssh/id_ed25519
      - key: gh_hosts
        type: file
        host_path: ~/.config/gh/hosts.yml
        target: /home/scion/.config/gh/hosts.yml
      - key: kubeconfig
        type: file
        host_path: ~/.kube/config
        target: /home/scion/.kube/config
```

Default read-only (already the case in `writeFileSecrets`). Covers ssh keys, gh tokens, kubeconfig, aws, db URLs — all via one unified mechanism.

**PR #66 status:** ❌ not addressed, and orthogonal (#66 is auth-path; this is general file projection).

**Root 3.0 impact:** HIGH for anything beyond self-contained code changes. Subsumes gap 9's ask.

---

### Gap 11 — No `node_modules` cache strategy

**Evidence:** Every fresh agent worktree pays the full `npm install` tax (~4 min for brandcast-sized monorepos). Multiplies with parallel agents — a 5-group execution batch incurs 20 minutes of npm install before any real work starts.

**Revised understanding (post-source-dive):** image customization is already fully supported — this is not a missing Scion primitive.

**What already works:**

- `HarnessConfigEntry.Image` at `pkg/config/settings_v1.go:533` — per-harness image override in `settings.yaml`
- `image_registry` at `settings_v1.go:235` — global registry rewrite
- `--image` CLI flag at `cmd/start.go:45` — per-invocation override
- `ScionConfig.Image` in template `scion-agent.yaml` at `pkg/api/types.go:314` — per-template pin
- Base image hierarchy (`image-build/` — `core-base` → `scion-base` → harness) with `ARG BASE_IMAGE` on every harness Dockerfile supports `FROM scion-claude`-style derivation cleanly

**Blessed path for a brandcast derived image:**

```dockerfile
FROM scion-local/scion-claude:latest
COPY package.json package-lock.json /tmp/brandcast/
RUN cd /tmp/brandcast && npm ci --no-audit --no-fund
# stage node_modules at a known path; symlink into the workspace at agent start
```

Push to a registry, set `image: ghcr.io/brandcast/scion-claude-brandcast:<lockhash>` under a named `harness_configs:` entry, done.

**Reframe:** this becomes a Root-side concern — "consumer-project derived-image pattern" — not an upstream Scion gap. Lives as a Root issue, not the Scion filing list.

**What *would* be upstream nice-to-haves** (none load-bearing for Root 3.0):
- `scion image build --project <grove>` CLI command
- Lockfile-hash-triggered rebuild
- Init-script hook at agent start for per-run dep re-install

**PR #66 status:** N/A — not an auth problem.

**Root 3.0 impact:** HIGH for performance, but unblocked today via image derivation. Needs Root-side tooling + docs, not Scion upstream work.

---

### Gap 12 — Telemetry consumer schema not documented

**Evidence:** `sciontool status task_completed "<summary>"` fires through Scion's OTEL pipeline (ports 4317 gRPC / 4318 HTTP, exposed in container). We observed the event but the canonical span structure, lifecycle, and stability guarantees are undocumented.

**Suggested fix:** Publish `TELEMETRY.md` covering:
- Span names emitted by sciontool (lifecycle events, task milestones)
- Attribute schema for each span type (agent name, task summary, completion status, SHA if applicable)
- Backward-compat policy for span schema
- Example consumer (Go / TypeScript) subscribing to `localhost:4317`

**PR #66 status:** ❌ not addressed.

**Root 3.0 impact:** HIGH — reconciliation engine subscribes to these spans as the authoritative "work done" signal. Undocumented schema is a ship blocker.

---

### Gap 13 — Container memory defaults undersized for monorepo tooling

**Evidence:** brandcast's `lint-staged` pre-commit hook required `NODE_OPTIONS=--max-old-space-size=8192` + `TURBO_CONCURRENCY=1` to fit inside the container during a commit. The agent figured this out and applied the workaround autonomously, but it's friction in every session with comparably heavy toolchains.

**Suggested fix:** Either:
- Raise default container memory (may conflict with lightweight-agent design goals)
- Expose per-template `resources:` config in `settings.yaml` (mirror K8s pattern):
  ```yaml
  profiles:
    local:
      resources:
        memory: 16Gi
        cpus: 4
  ```

**PR #66 status:** ❌ not addressed.

---

### Gap 14 — Lockfile platform-pinned native deps

**Evidence:** brandcast's `package-lock.json` pinned Mac-native `sharp` binaries. Inside a Linux-arm64 container, the agent had to run `npm install --os=linux --cpu=arm64 sharp` as a recovery step. Similar story would hit `better-sqlite3`, `@swc/core`, `esbuild`, and any other native Node module.

This is primarily a consumer-project problem (lockfile generation), not Scion's. But the container surface makes it painfully visible to users who'd otherwise never think about it.

**Suggested fix:** Scion documentation: add a "Working with JavaScript/TypeScript projects" section that recommends either:
- Generating multi-platform lockfiles (`npm install --platform=linux --arch=arm64 --force`)
- A pre-start hook that re-installs per-platform native modules

**PR #66 status:** ❌ not addressed (out of scope).

---

## Summary matrix

| # | Gap | Severity | PR #66 |
|---|---|---|---|
| 1 | Claude OAuth auth path | HIGH | ✅ SOLVED |
| 2 | macOS Keychain propagation | HIGH | ⚠️ partial (wire format canonical) |
| 3 | Default templates hardcode Vertex | HIGH | ✅ **FIXED UPSTREAM** (commits `ed1f3d44`, `c66f0a29`, `8933ee10`) |
| 4 | No `--prompt-file` flag | MED | ❌ |
| 5 | Token refresh is manual | MED | ⚠️ simpler post-merge |
| 6 | No `--auth <method>` flag | MED | ✅ indirectly via `auth_selectedType` |
| 7 | Build script forces docker-container driver | MED | ❌ |
| 8 | Grove template drift | MED | ❌ |
| 9 | No `gh`/SSH propagation | LOW (HIGH for 3.0) | N/A — solvable via existing `volumes:`; subsumed by gap 10's cleaner ask |
| 10 | No local host-path projection (no-Hub) | LOW (HIGH for 3.0) | N/A — pipeline exists, missing `HostPath` field on `RequiredSecret` |
| 11 | No `node_modules` cache strategy | LOW (HIGH for 3.0) | N/A — image derivation supported; this is Root-side tooling, not a Scion gap |
| 12 | Telemetry schema undocumented | LOW (HIGH for 3.0) | ❌ |
| 13 | Container memory defaults | LOW | ❌ |
| 14 | Lockfile platform pinning | LOW | ❌ (out of scope) |

## Recommended filing sequence

1. ~~**Companion to PR #66: template split** — gap 3.~~ **No longer needed — already fixed upstream.**
2. **`--prompt-file` flag** — gap 4. Easy implementation; unblocks reliable envelope transport for any Scion consumer.
3. **Pre-start hook for credential refresh** — gap 5. Proper long-term primitive.
4. **Telemetry schema docs** — gap 12. Ship blocker for Root 3.0 reconciliation.
5. **Local host-path projection on file secrets** — gap 10 (subsumes gap 9). Narrow, additive, reuses existing `writeFileSecrets` machinery. Draft at `dev/scion/upstream-issues.md`. Candidate for Root-authored PR.
6. **Build script `--driver` flag** — gap 7. Small, self-contained, removes first-time-setup friction. Already have the patch on `root/local-docker-driver` branch.
7. **Grove template refresh** — gap 8. Medium-sized design question (overlay vs. command).
8. **Container memory config** — gap 13. Low priority.

Gaps 9 and 11 do not need upstream filings; see their revised entries.

## Cross-references

- `dev/scion/setup.md` — the full setup recipe, documents the workarounds for all HIGH-severity gaps
- `dev/scion/upstream-issues.md` — drafts of issues to file against Scion; currently holds the gap 10 merged draft
- Root 3.0 tracking issues: #2, #3, #4, #5, #6 in `BrandCast-Signage/root`
- brandcast PR [#1487](https://github.com/BrandCast-Signage/brandcast/pull/1487) — first real-world Scion-dispatched fix (draft, do-not-merge)
- Scion PR [#66](https://github.com/GoogleCloudPlatform/scion/pull/66) — closes gap 1, partial on gap 2
