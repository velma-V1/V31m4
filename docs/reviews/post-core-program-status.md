# Post-Core Program Status (2026-08-09)

Status of the approved post-core sequence (main promotion, stable tag, core freeze, department
host, Video and 3D/Game departments, outbox retention). The immutable audited product-code baseline
is `78dc2b7`; the post-core work is additive and does not modify the frozen L1–10 core tree.

## Phase 1 — Main promotion: COMPLETE

`main` was fast-forwarded from `fbbebdd` to the promoted core commit (`9801338`) — a clean
fast-forward of 38 commits, no force, no merge commit, all prior history preserved.

## Phase 2 — Stable core release tag: LOCAL only, remote push BLOCKED (external)

Annotated tag `v31m4-core-l1-10-stable` exists locally at `9801338`. Pushing it is blocked by
egress/organization policy: `git push` of a `refs/tags/*` ref returns HTTP 403 (branch pushes to
`refs/heads/*` succeed), and the GitHub MCP server exposes no tag/release/ref-creation tool. Not
retried per policy. Needs an admin to allow tag pushes, or a human to create the tag/release at
`9801338`. Tag publication is recorded as an external/human action and does not gate engineering.

## Phase 3 — Core freeze: IN EFFECT

L1–L10 is the frozen platform. The post-core work added new packages only and changed no core
source: departments and the host depend on the core through existing ports; core imports nothing
from them.

## Phase A — Generic department host SDK: COMPLETE

`packages/department-host` — the generic post-core extension platform. It owns the department
lifecycle (install → enable → start → invoke/health → stop → disable → remove) on the existing
`PluginRegistryPort` (durable registration + coarse status) and unit of work; isolation is delegated
to a swappable `DepartmentConnector` (supervised process or in-process module); isolated storage is
allocated via a `WorkspaceAllocator` with install/remove rollback. Fails closed on invalid manifest,
incompatible host API version, ungranted permission, and missing tool/model dependency. **12 tests.**

## Phase B — Video Production department: COMPLETE

`plugins/video-production` — a removable department derived from
`docs/deferred/video-production`. Deterministic software owns the long-horizon workflow (per-shot
generate → vision-QC → bounded correction/repair → accept; assemble; verify); generation, QC, and
assembly are replaceable adapters with deterministic reference implementations so orchestration,
caching, and recovery are verifiable without ffmpeg/Blender/ComfyUI/generation-vision models present
(those are `optionalToolIds`, dropped in behind the same interfaces on a target host). Project
workflow state is separated from the content-addressed accepted-shot cache; interrupted productions
resume from their last checkpoint without regenerating accepted shots; output is checksum-verified.
**7 tests.**

## Phase C — 3D/Game Production department: COMPLETE

`plugins/game-production` — a removable department derived from
`docs/deferred/game-production`, independent of Video (no cross-import). Deterministic software owns
the project workflow (per-scene acquire assets → engine build → validate → bounded repair → accept;
package; verify); asset, build, validation, and packaging are replaceable adapters with deterministic
reference implementations so orchestration is verifiable without Godot/Unreal/Blender present (those
are `optionalToolIds`). No replacement engine is built. Workflow state is separated from the
content-addressed built-scene cache; interrupted projects resume without rebuilding accepted scenes;
the package is checksum-verified. **8 tests.**

## Phase D — Independence / integration: COMPLETE

`apps/departments-integration` proves the independence matrix with a composite connector binding both
departments by manifest id: core operates with zero departments; both run together; removing one
leaves the other working; and the host operates after both are removed. **2 tests.**

Dependency direction verified: core (`domain`/`contracts`/`application`/`infrastructure`/`apps/runtime`)
imports nothing from the host or departments; the host imports no department; Video and Game do not
import each other; department source imports only `@v31m4/application` and `@v31m4/department-host`
(infrastructure is a test-only dev dependency); zero explicit `any`; no Open Generative AI or
provider/engine SDK in core — external engines/models remain strictly at replaceable adapter
boundaries.

## Phase 6 — Outbox retention/pruning: INTENTIONALLY DEFERRED

Unbounded durable-log growth remains an operational scalability limitation, not a correctness defect,
deferred pending real workload/storage evidence (retention requirements, safe horizon, recovery/replay
expectations, thresholds). The replay store already supports pruned history (`refresh_required`), so
the future work has a landing point. See `docs/reviews/production-readiness-audit.md`.

## Verification

Full native gate with departments installed: `pnpm typecheck` 9/9, `pnpm build` 9/9, `pnpm test`
369 cases / 75 files, `pnpm lint` / `pnpm check` green (0 errors, 1 info). Real external
integrations (ffmpeg/Blender/Godot/Unreal/ComfyUI/generation-vision models) are contract-tested via
replaceable adapters and deterministic reference adapters; execution against those tools on a target
host is separate validation, out of scope for this sandbox.

## Net state

- Completed: Phases 1, 3, A, B, C, D; Phase 6 deferred by design.
- Blocked, external action: Phase 2 remote tag push (403 policy) — local tag exists at `9801338`.
- Frozen audited code baseline: `78dc2b7`. Core packages unchanged; departments are additive and
  removable.
