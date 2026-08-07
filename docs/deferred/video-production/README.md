# Deferred Video Production Department

**Status:** Deferred until after V31M4 core completion
**Type:** First-party removable production plugin
**Core dependency:** None

## Purpose

Preserve the Video Production Department design without allowing it to delay or couple to the core build. The future department should support both normal video production and occasional autonomous long-form AI video/movie creation.

## Preserved direction

The original Video Production Department remains the baseline because it is stronger overall than a single generative-media repository. Preserve its production depth in editing, compositing, audio, 3D integration, restoration/upscaling, local tooling, rendering/assembly, QC, recovery, and production workflows.

## Priority upgrades when work resumes

1. **Long-form autonomy**
   - idea/script to scenes and shots
   - persistent movie/world state
   - character, wardrobe, location, prop, and timeline continuity
   - checkpoint/resume
   - automatic assembly
   - bounded retries and repair

2. **Small-model orchestration**
   - architecture must be operable by an ordinary 4B instruct model using narrow skills and structured state
   - 7B-14B models are optional quality/headroom upgrades, not requirements
   - deterministic software owns workflow state and long-horizon execution

3. **Vision QC specialist**
   - independent vision model checks identity, continuity, prompt adherence, visual corruption, and temporal problems
   - vision findings drive repair/retry decisions
   - the text controller does not certify its own visual work

4. **Generation quality**
   - reference-first image/video generation when continuity matters
   - capability/quality/cost-aware model routing
   - best-of-N generation for important assets/shots
   - quality tiers so premium generation is reserved for shots that benefit from it

5. **Existing-component-first evaluation**
   - evaluate ViMax or equivalent long-form autonomy projects before custom-building orchestration
   - reuse existing production tools when they beat custom replacements

## Open Generative AI note

Open Generative AI is **not** part of V31M4 core and is **not** pre-approved as the Video Department foundation.

When Video Production work resumes, evaluate Open Generative AI only as an optional source of reusable parts, such as:

- model-provider integrations
- image/video generation adapters
- generation workflow ideas
- UI patterns
- media tooling

Adopt only parts that measurably improve the finished department compared with the existing design. The department must remain provider-replaceable and must not depend on Open Generative AI for core startup or V31M4 operation.

## Future integration boundary

Video Production must connect to V31M4 only through generic plugin/runtime contracts for capabilities, tools, models, jobs, artifacts, checkpoints, verification/evidence, resources, approvals, workspaces, and events.

No video-specific business logic belongs in core packages.

## Resume gate

Do not implement this department until the V31M4 core is release-complete and its generic plugin slots are verified without Video Production installed.
