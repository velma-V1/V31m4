# Target-Host Validation Procedure — Department Production Adapters

Scope: the real external production tools used by the Video and 3D/Game departments. This document
records what was and was **not** executed here, and defines the minimum reproducible procedure to
validate the real production adapters on a target production machine (e.g. Windows with GPU and the
tools installed). No claim of execution beyond what is stated is made.

## Execution status in this environment (accurate)

- **Executed and passing here:** the departments' deterministic *reference* adapters and their
  orchestration/lifecycle/recovery/verification tests (department-host 12, Video 7, 3D/Game 8,
  integration 2). These use no external executables and prove the workflow, caching, checkpoint/
  resume, output verification, and removability.
- **NOT executed here:** Blender, Godot, Unreal, ffmpeg, ComfyUI, and any real image/video/vision
  generation or QC model. This sandbox has no GPU, does not have those tools installed, and its
  outbound network is policy-restricted. The production adapters that would drive those tools are
  defined as replaceable interfaces (`ShotGenerationAdapter`/`VisionQcAdapter`/`AssemblyAdapter` for
  Video; `AssetAdapter`/`SceneBuildAdapter`/`SceneValidationAdapter`/`PackageAdapter` for Game) but
  their real implementations are not built and were not run here.

## What a production adapter must satisfy (contract parity)

A real adapter is a drop-in for its reference counterpart and must preserve the behavior the
orchestrator depends on:

- **Determinism of identity:** for the same input, return a stable content reference. If the real
  tool is non-deterministic, the adapter must compute the content reference from the actual output
  bytes (hash the produced file) so the cache and checksum verification remain sound.
- **Output verification:** the assembly/package adapter's `checksum` must be derivable from the
  accepted item references exactly as the reference adapter computes it, or the department's
  post-assembly verification must be adjusted in lockstep and re-tested. Do not weaken verification.
- **Failure surfacing:** tool failures must throw (they are classified as `DEPENDENCY_FAILURE` at the
  host boundary); partial output must not be reported as success.
- **Isolation:** all reads/writes stay inside the department's allocated workspace; no traversal.

## Minimum reproducible procedure (target host)

Prerequisites on the target machine (record exact versions actually used):
- Node 22.x, pnpm 11.x (match this repo's toolchain).
- The external tools under test, on `PATH`: ffmpeg; Blender; Godot (and/or Unreal); ComfyUI or the
  chosen generation backend; the chosen vision-QC model endpoint. GPU as required.

Steps:
1. Clone the repo at the tag/commit under validation and `pnpm install --frozen-lockfile`.
2. Implement the production adapters behind the existing interfaces (a new `plugins/*/src` module or
   a separate adapter package), wiring each to its real tool via the Layer 8 supervised-process +
   JSON-RPC boundary where a child process is involved. Do **not** modify the department
   orchestrators or the frozen core.
3. Add target-host integration tests (kept separate from the sandbox unit tests; gate them behind an
   env flag such as `V31M4_TARGET_HOST=1` so they never run in CI without the tools):
   - Video: render a small real production; assert the department reaches `completed`, the final
     output file exists, and re-running reuses cached accepted shots (no regeneration).
   - Game: build a small real project; assert `completed`, the package artifact exists, and a
     re-run reuses cached accepted scenes (no rebuild).
   - Failure/recovery: kill the tool mid-run; assert the department resumes from its checkpoint
     without repeating accepted work.
4. Record, in an evidence file on the target host: exact tool versions, OS/GPU, commands run,
   produced artifact paths + hashes, pass/fail per assertion, and timings. Only then may execution
   of a specific tool be claimed — and only for the versions actually run.

## Honesty rule

Never state that Blender, Godot, Unreal, ffmpeg, ComfyUI, or any real generation/vision model was
executed unless it was actually executed on a target host and the evidence above was recorded. In
this repository's current state, they were not.
