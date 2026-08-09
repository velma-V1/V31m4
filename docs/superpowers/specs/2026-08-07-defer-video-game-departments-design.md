# Defer Video and Game Departments Design

**Status:** Approved architecture scope change
**Date:** 2026-08-07
**Architecture baseline:** V31M4-SRS-001 / 1.0.0

## Decision

Video Production and 3D/Game Production are deferred until after the V31M4 core reaches its release-complete state. Neither department is a core dependency, startup dependency, release gate, packaging dependency, or acceptance prerequisite.

Both departments remain first-party production extensions in the repository architecture so their designs are preserved for later implementation.

## Core boundary

The core must provide only generic extension seams needed by any production plugin:

- plugin registration and lifecycle
- capability registration
- model and tool gateway access
- workflow/job execution
- artifact creation and retrieval
- checkpoint/resume support
- verification/evidence hooks
- resource-governor requests
- approval/policy requests
- isolated workspaces
- runtime events

No video-specific or game-specific business logic belongs in the core.

Core startup, verification, packaging, and release must succeed with both departments absent.

## Deferred Video Production department

The Video Production department remains a post-core first-party plugin. Its preserved design direction is:

- retain the original production-tool depth rather than replacing the department with a single generative-media repository
- prioritize long-form autonomous video/movie creation as the main future capability gap
- design orchestration so an ordinary 4B instruct model with bounded skills can complete the workflow; 7B-14B models are optional quality/headroom upgrades
- use persistent movie/world state for characters, wardrobe, locations, props, timeline, and continuity
- use reference-first image/video generation where continuity matters
- use a vision model as an independent visual-QC and repair-diagnosis specialist
- support automatic retries, fallback, checkpoint/resume, and final assembly
- preserve editing, compositing, audio, 3D, restoration, local tooling, and final-delivery capabilities from the original department design
- evaluate ViMax or equivalent existing autonomy components before building custom long-form orchestration
- evaluate Open Generative AI only later as an optional source of reusable components such as provider integrations, generation workflows, UI patterns, or media tooling. Open Generative AI is not approved as a core dependency and is not approved in advance as the Video Department foundation.

The Video Department must integrate only through generic core extension contracts.

## Deferred 3D/Game Production department

**Superseded 2026-08-09** for the real-engine-integration question by
`docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`: the department
shell itself is no longer deferred (implemented and verified — see
`docs/reviews/post-core-program-status.md`, Phase C), and its real (non-reference) adapters are to
be built against Summer as the execution platform rather than a custom Godot/Unreal agent stack.
The paragraph below is retained as the historical record of the original deferral decision.

The 3D/Game Production department remains a post-core first-party plugin. Game-engine-specific agents, Godot/Unreal integrations, asset-generation pipelines, engine automation, simulation, testing, preview, build, and export workflows are deferred.

The Game department must integrate only through generic core extension contracts and may not require core redesign.

## Repository placement

Until implementation begins, deferred department designs live under:

- `docs/deferred/video-production/`
- `docs/deferred/game-production/`

Do not create empty runtime/plugin implementation packages merely as placeholders. Runtime package paths are chosen when each department enters implementation and must follow the then-current plugin SDK conventions.

## Acceptance rules

The core architecture is ready for these future departments when tests prove that a generic production plugin can register capabilities, invoke governed tools/models, create jobs and artifacts, checkpoint/resume, request approvals/resources, emit evidence/events, fail without crashing the authoritative runtime, and be disabled or removed without corrupting core state.

No acceptance test may require Video Production or 3D/Game Production itself.
