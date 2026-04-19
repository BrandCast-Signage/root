---
title: Scion Custom Build — Root 3.0 Initial Testing
status: active
audience: root framework developers running Root 3.0 against Scion
---

# Scion Custom Build — Root 3.0 Initial Testing

**Scope:** What we carry ourselves during initial Root 3.0 testing, how to keep Docker disk usage bounded, and when to drop each piece. Temporary — everything here disappears when upstream catches up.

**Prereqs:** You've already worked through `dev/scion/setup.md` end-to-end.

---

## What we actually carry

Important re-scoping from the original gaps inventory: the Vertex env block, `duet01` project, `@default` model suffixes, and hardcoded Gemini `selectedType: gemini-api-key` are **already removed upstream** (commits `ed1f3d44`, `c66f0a29`, `8933ee10` on Scion `main`). Those embeds live in `pkg/harness/{claude,gemini}/embeds/settings.json` and are compiled into the `scion` CLI binary — not shipped in the harness images.

So the actual customization surface is:

1. **Scion source fork**, 2 commits ahead of upstream `main`:
   - `root/local-docker-driver` — buildx patch for single-arch local builds (`image-build/scripts/build-images.sh`)
   - Cherry-pick of [PR #66](https://github.com/GoogleCloudPlatform/scion/pull/66) — Claude OAuth auth path (load-bearing until merged)
2. **Locally-rebuilt `scion` CLI binary** from that fork
3. **Locally-rebuilt harness images** under the `scion-local/` registry prefix. Content is identical to upstream; we rebuild only so grove settings can point at a local registry instead of GCP Artifact Registry.
4. **(Optional) Consumer-derived image** per project, to amortize `npm install` cost. Brandcast uses this; other consumers may skip it.

No custom harness content, no custom entrypoints, no custom `settings.json` embeds. If you find yourself editing harness files, stop — something is upstream that shouldn't be.

---

## 1 — Scion source fork

### Branch layout

Working branch: `root/local-docker-driver` in `~/Code/scion`. Structure:

```
main (upstream HEAD, periodically pulled)
  └── root/local-docker-driver (our working branch)
        • 25f74784 build: use active docker-driver buildx builder
        • (cherry-picked) feat: add OAuth token auth support for Claude harness (PR #66)
```

The docker-driver commit is permanent (we'll keep it until Scion exposes `--driver docker` upstream, gap 7). The PR #66 cherry-pick is temporary and disappears the day the PR merges.

### Cherry-pick PR #66

```bash
cd ~/Code/scion
git fetch origin pull/66/head:pr-66
git checkout root/local-docker-driver
git cherry-pick pr-66
```

If the cherry-pick conflicts after an upstream rebase, abandon it and re-fetch: `git cherry-pick --abort && git branch -D pr-66 && git fetch origin pull/66/head:pr-66 && git cherry-pick pr-66`.

### Build the CLI

```bash
cd ~/Code/scion
go install ./cmd/scion
scion version  # confirm it's our build, not the one from `go install github.com/...@latest`
```

`$GOPATH/bin/scion` (or `~/go/bin/scion`) now shadows anything on `$PATH`. Confirm with `which scion`.

### Refresh cadence

Pull upstream weekly, rebase our branch:

```bash
cd ~/Code/scion
git fetch origin
git checkout main && git pull --ff-only
git checkout root/local-docker-driver
git rebase main
go install ./cmd/scion
```

Watch for: (a) PR #66 merged — drop the cherry-pick, (b) docker-driver flag landed upstream — drop that commit too, at which point this whole file becomes obsolete and we go back to `go install github.com/GoogleCloudPlatform/scion/cmd/scion@latest`.

---

## 2 — Local harness images

Only rebuild the harnesses we use. Building all four (`claude`, `gemini`, `codex`, `opencode`) wastes ~15 GB of disk on images we never launch.

```bash
cd ~/Code/scion
bash image-build/scripts/build-images.sh --registry scion-local --target claude
bash image-build/scripts/build-images.sh --registry scion-local --target gemini
```

### Tag strategy

The build script tags as `scion-local/scion-<harness>:latest`. For reproducibility and clean rollback, add a dated + scion-sha tag after every rebuild:

```bash
sha=$(cd ~/Code/scion && git rev-parse --short HEAD)
date=$(date +%Y%m%d)
for img in scion-claude scion-gemini scion-base core-base; do
  docker tag scion-local/$img:latest scion-local/$img:$date-$sha
done
```

`settings.yaml` continues to reference `:latest`; the dated tags are rollback insurance and make the cleanup script's "older than N days" filter trivial.

---

## 3 — Consumer-derived image (optional, brandcast example)

**When to use:** projects where `npm install` / `pnpm install` on a fresh worktree is expensive enough that paying it per-agent-per-launch breaks parallel execution economics. Brandcast hits ~4 min install time; at 5-way parallelism that's 20 min of dead time per dispatch.

**When to skip:** small projects, or any project where deps install in under 30s.

### Dockerfile pattern

Consumer-owned. For brandcast, lives (for now) in `~/Code/brandcast/.scion/images/Dockerfile.claude`:

```dockerfile
# syntax=docker/dockerfile:1
FROM scion-local/scion-claude:latest

USER scion
WORKDIR /home/scion/deps-cache

# Copy ONLY the files that affect dependency resolution.
# This keeps the layer cache valid across unrelated source changes.
COPY --chown=scion:scion package.json package-lock.json ./
COPY --chown=scion:scion apps/backend/package.json apps/backend/
COPY --chown=scion:scion apps/displays/package.json apps/displays/
# ... one COPY per workspace package.json

RUN npm ci --no-audit --no-fund --prefer-offline

# Agent entrypoint stays default from the base image.
WORKDIR /workspace
```

At agent start, the workspace mount at `/workspace` is a fresh worktree — no `node_modules` yet. Either:
- Have the agent symlink `/workspace/node_modules` → `/home/scion/deps-cache/node_modules` (fast, but breaks workspace-relative resolution for some tools)
- Or have the agent run `npm ci --prefer-offline` — which hits the pre-warmed npm cache from the image layer and finishes in seconds instead of minutes

The symlink approach is faster but brittle against dep drift; the `npm ci --prefer-offline` approach is slower-but-correct. Brandcast uses the latter.

### Build and tag

Use the lockfile hash as the addressable tag so rebuilds are deterministic and collisions are impossible:

```bash
cd ~/Code/brandcast
lockhash=$(sha256sum package-lock.json | cut -c1-12)
docker build \
  -f .scion/images/Dockerfile.claude \
  -t scion-local/scion-claude-brandcast:$lockhash \
  -t scion-local/scion-claude-brandcast:latest \
  .
```

`:<lockhash>` is the permanent, content-addressed tag. `:latest` is the moving pointer `settings.yaml` references.

### Wire it into the grove

In the grove's `.scion/settings.yaml`, under a named `harness_configs:` entry:

```yaml
harness_configs:
  claude:
    image: scion-local/scion-claude-brandcast:latest
```

(Confirm the exact field name against `~/Code/scion/pkg/config/settings_v1.go:533` — `HarnessConfigEntry.Image` — if Scion bumps the schema.)

### When to rebuild

Rebuild whenever `package-lock.json` changes meaningfully (new direct deps, version bumps, not just transitive churn). Easy signal: compare `lockhash` before and after.

---

## Docker disk hygiene

Images get big fast — each harness is 3.7–4.4 GB, the brandcast-derived image adds another ~2 GB, and every rebuild leaves the prior tagged version + dangling layers behind. Unattended, this fills 50 GB in a couple of weeks.

### Check current state

```bash
docker system df
docker images --filter "reference=scion-local/*" --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}'
```

### Cleanup routine (run weekly, or after any rebuild cycle)

```bash
# 1. Reap stopped agent containers (scion stop normally handles this; this catches orphans)
docker ps -a --filter "status=exited" --format '{{.ID}}\t{{.Image}}' \
  | awk '$2 ~ /^scion-local\// {print $1}' \
  | xargs -r docker rm

# 2. Remove dated scion-local/* tags older than 14 days
#    (relies on the YYYYMMDD-<sha> tag convention from section 2)
cutoff=$(date -v-14d +%Y%m%d 2>/dev/null || date -d '14 days ago' +%Y%m%d)
docker images --filter "reference=scion-local/*" --format '{{.Repository}}:{{.Tag}}' \
  | awk -F: -v c="$cutoff" '$2 ~ /^[0-9]{8}-/ && substr($2,1,8) < c {print $0}' \
  | xargs -r docker rmi

# 3. Remove brandcast-derived images except :latest and the current lockhash
current_lockhash=$(sha256sum ~/Code/brandcast/package-lock.json 2>/dev/null | cut -c1-12)
docker images --filter "reference=scion-local/scion-claude-brandcast" --format '{{.Repository}}:{{.Tag}}' \
  | grep -v ":latest$" \
  | grep -v ":$current_lockhash$" \
  | xargs -r docker rmi

# 4. Dangling layers from failed/overwritten builds
docker image prune -f

# 5. Buildx cache not used in the last week
docker buildx prune -f --filter "unused-for=168h"

# 6. Show the result
docker system df
```

Don't run `docker system prune -a` — it nukes everything not attached to a running container, including stopped brandcast dev DBs, other unrelated dev work, etc. The scoped cleanup above only touches `scion-local/*` and dangling refs.

This could graduate to `dev/scion/cleanup.sh` alongside the helpers proposed in Root issue #2 (`reseed.sh`, `launch.sh`, `status.sh`). For now it lives here as copy-paste.

### Budget expectations

Steady-state with this hygiene:

| Artifact | Size |
|---|---|
| `scion-local/core-base:latest` | ~1.0 GB |
| `scion-local/scion-base:latest` | ~1.8 GB |
| `scion-local/scion-claude:latest` | ~3.7 GB |
| `scion-local/scion-gemini:latest` | ~4.4 GB |
| `scion-local/scion-claude-brandcast:latest` | ~5.5 GB (claude base + node_modules layer) |
| Dated rollback tags (harness × 2 weeks × rebuild cadence) | ~2–4 GB |
| Buildx cache, working set | ~5–10 GB |
| **Total steady-state** | **~25 GB** |

If `docker system df` shows >40 GB attributable to Scion, the cleanup routine didn't run or something is leaking (usually orphan agent containers).

---

## Maintenance

**Weekly:**
- `cd ~/Code/scion && git fetch origin && git rebase main && go install ./cmd/scion`
- Rebuild harness images if the rebase touched `image-build/`, `pkg/harness/*/embeds/`, or anything in `pkg/agent/` / `pkg/runtime/`
- Run the cleanup routine above

**Per-session:**
- `dev/scion/reseed.sh` (issue #2) for credentials — unchanged by anything here

**Watch for upstream movement:**
- PR #66 merged → drop cherry-pick, rebuild binary, remove the `--no-auth` workaround from `dev/scion/setup.md` Step 6
- `build-images.sh --driver docker` landed → drop the buildx patch, go back to stock `go install github.com/GoogleCloudPlatform/scion/cmd/scion@latest`

---

## Exit conditions

Per-piece disposition:

| Piece | Dropped when |
|---|---|
| PR #66 cherry-pick | PR #66 merges upstream |
| Docker-driver buildx patch | Scion exposes `--driver` flag (gap 7) |
| Local harness images | Scion publishes images to a pullable public registry we trust, or we stop needing single-arch local control |
| Brandcast-derived image | Scion exposes a blessed init-hook or pre-warm mechanism (gap 11 nice-to-have), OR brandcast perf stops mattering for dispatch |
| This document | All of the above |

When the list empties, delete `dev/scion/custom-images.md`, `dev/scion/gaps.md`, and `dev/scion/setup.md` in one commit. Root goes back to `go install ...@latest` and stock images.
