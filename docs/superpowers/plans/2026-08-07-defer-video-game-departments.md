# Defer Video and Game Departments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Video Production and 3D/Game Production from the V31M4 core completion path while preserving their designs in-repo as deferred first-party plugins.

**Architecture:** Keep the existing Clean Architecture and removable-plugin boundary. Core owns only generic plugin/runtime seams; department-specific logic is documented under `docs/deferred/` and must not become a startup, packaging, test, or release dependency.

**Tech Stack:** Markdown architecture governance; existing V31M4 plugin/model/tool/job/artifact contracts.

## Global Constraints

- Preserve `V31M4-SRS-001 / 1.0.0` dependency direction.
- Do not implement either deferred department.
- Do not add Open Generative AI to core.
- Do not create empty runtime plugin packages as placeholders.
- Core completion and release must succeed with both departments absent.

---

### Task 1: Record the scope decision

**Files:**
- Create: `docs/superpowers/specs/2026-08-07-defer-video-game-departments-design.md`

**Interfaces:**
- Consumes: existing first-party plugin boundary.
- Produces: authoritative scope decision for later architecture documents.

- [x] **Step 1:** Record Video and Game as post-core first-party extensions.
- [x] **Step 2:** Record the generic core seams required for later attachment.
- [x] **Step 3:** Record that neither department may block core release.

### Task 2: Preserve deferred department designs

**Files:**
- Create: `docs/deferred/video-production/README.md`
- Create: `docs/deferred/game-production/README.md`

**Interfaces:**
- Consumes: generic plugin/runtime contracts.
- Produces: preserved post-core design intent without executable dependencies.

- [x] **Step 1:** Preserve the updated Video Production direction, including long-form autonomy, 4B orchestration, vision QC, generation-quality upgrades, and optional later evaluation of Open Generative AI parts.
- [x] **Step 2:** Preserve the Game Production scope and future plugin boundary.

### Task 3: Update architecture governance

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`

**Interfaces:**
- Consumes: deferred-department scope decision.
- Produces: discoverable ownership and core release rules for future contributors.

- [x] **Step 1:** Add a core-completion scope section to `docs/architecture.md`.
- [x] **Step 2:** Add ownership entries for `docs/deferred/video-production` and `docs/deferred/game-production` to `docs/repository-map.md`.
- [x] **Step 3:** Add the current deferral decision to `repo_map.md` without changing implemented-layer claims.
- [x] **Step 4:** Re-fetch all changed files and verify there are no contradictory statements or accidental core dependencies.

## Verification result

Documentation-only change verified by re-fetching the deferred department specs, `docs/architecture.md`, `docs/repository-map.md`, and `repo_map.md` from `canonical/layers-6-10`. The existing SRS already classifies Video Production and 3D/Game Production as removable first-party production plugins, so this scope change strengthens the existing boundary rather than changing dependency direction.
