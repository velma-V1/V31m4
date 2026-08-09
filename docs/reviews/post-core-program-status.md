# Post-Core Program Status (2026-08-09)

Status of the approved post-core sequence (main promotion, stable tag, core freeze, Video and
3D/Game departments, outbox retention). The immutable audited product-code baseline is `78dc2b7`.

## Phase 1 — Main promotion: COMPLETE

`main` was fast-forwarded from `fbbebdd` to the promoted core commit (`9801338`) — a clean
fast-forward of 38 commits, no force, no merge commit, all prior `main` history preserved. `main`,
`canonical/layers-6-10`, and the source branch are aligned. The delta from `78dc2b7` to the promoted
commit is documentation/control-state only (no product-code change).

## Phase 2 — Stable core release tag: BLOCKED (remote), local tag created

An annotated tag `v31m4-core-l1-10-stable` was created locally at the promoted core commit
(`9801338`). Pushing it to the remote is **blocked by egress/organization policy**: `git push` of a
`refs/tags/*` ref returns **HTTP 403** (branch pushes to `refs/heads/*` succeed). Per environment
policy, 403 denials are not retried. The GitHub MCP server exposes no tag/release/ref-creation tool
(`create_branch` only creates `refs/heads/*`), so there is no alternate automated path.

**Needs:** an admin to allow tag-ref pushes for this session (Claude GitHub settings / repo ruleset),
or a human to create the annotated tag/release at commit `9801338`. `78dc2b7` remains the immutable
audited code baseline regardless of where the tag lands.

## Phase 3 — Core freeze: IN EFFECT

L1–L10 is the frozen platform. Core changes are allowed only for an evidence-backed defect, a
genuinely missing generic extension seam surfaced by department integration, or a minimal fix that
keeps existing behavior protected by regression tests. No speculative core layers, no redesign of the
working architecture, no core dependency on Video or 3D/Game, and no weakening of security/reliability
boundaries. Departments consume the platform; they do not redefine it.

## Phases 4 & 5 — Video and 3D/Game departments: BLOCKED (prerequisite + design + resources)

These cannot be implemented to a genuine, verifiable standard from the current repository and
environment. Three independent, evidence-backed blockers:

1. **Unmet resume-gate precondition — no generic plugin slots exist.** Both deferred designs state:
   "Do not implement this department until the core is release-complete AND its generic plugin slots
   are verified without [the department] installed." The core has a plugin *registration ledger*
   (`SqlitePluginRegistry`) but **no plugin SDK, host, or loader** — nothing that packages, loads,
   isolates, runs, or removes a first-party department. The `plugins/` and `adapters/` workspace
   directories do not exist (only reserved globs). `repo_map.md` lists "plugin SDK, plugins" as not
   implemented. Building that host/SDK is a new platform capability with its own architecture
   decisions (packaging, lifecycle install/enable/disable/remove, isolation, capability/tool/model/
   job/artifact/checkpoint/verification/resource/approval/workspace/event wiring, versioning) — not a
   "minimal missing seam," and not specified by any source-of-truth document.

2. **Deferred designs are direction documents, not implementable architectures.**
   `docs/deferred/video-production/README.md` and `docs/deferred/game-production/README.md` define
   purpose, priorities, and a hard integration boundary — not a concrete department architecture,
   contracts, or module structure to "follow as authoritative." Implementing would require inventing
   that architecture, which the program rules forbid without evidence the design is invalid.

3. **Mandated reuse targets are unavailable in this environment.** The designs mandate
   "existing-component-first": evaluate/reuse ViMax, Blender, Godot/Unreal, ffmpeg, and image/video +
   vision-QC models before custom-building, and explicitly forbid rebuilding what established tooling
   already solves ("do not build a replacement game engine when established tooling satisfies the
   requirement"). None of that tooling, nor GPU/model-provider access, is present in this sandboxed,
   egress-restricted environment. Hand-rolling TypeScript replacements would directly violate the
   design and produce unverifiable, hollow "departments."

**Needs (product/architecture + environment decisions):**
- The plugin/department **host SDK** architecture (how departments are packaged, isolated, loaded,
  and removed) — designed and approved as an explicit platform step, since both departments sit on it.
- A resolution for the "reuse existing external tooling" mandate given this environment (which real
  engines/models/tools are available/approved, or an execution environment that has them).
- Concrete, implementable department specs (or approval to derive them), replacing the current
  direction documents.

Fabricating placeholder departments was deliberately **not** done: it would violate the designs'
reuse-first mandate and DO_NOT rules, could not be meaningfully verified (render/cache/QC/output),
and would lower result quality — contrary to the operating contract's CORRECTNESS-first priority.

## Phase 6 — Outbox retention/pruning: INTENTIONALLY DEFERRED

Unbounded durable-log growth is an operational scalability limitation, not a correctness defect. It
remains deferred pending real workload/storage evidence (retention requirements, safe horizon,
recovery/replay expectations, operational thresholds). The replay store already supports pruned
history (`refresh_required` when a cursor predates `oldest`), so the future work has a landing point.
See `docs/reviews/production-readiness-audit.md`.

## Net state

- Completed: Phase 1 (main promotion), Phase 3 (freeze policy in effect), Phase 6 (deferral recorded).
- Blocked, needs a decision/action outside repository evidence: Phase 2 (tag-push policy), Phases 4–5
  (department host SDK + implementable specs + reuse-tooling environment).
- Frozen audited code baseline: `78dc2b7`. Promoted core commit on `main`/`canonical`: `9801338`.
