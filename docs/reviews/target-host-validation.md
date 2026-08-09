# Target-Host Validation Procedure — Department Production Adapters

Scope: the real external production tools used by the Video and 3D/Game departments. This document
records what was and was **not** executed here, and defines the minimum reproducible procedure to
validate the real production adapters on a target production machine (e.g. Windows with GPU and the
tools installed). No claim of execution beyond what is stated is made.

## Target-host capability matrix (verified 2026-08-09, local target machine)

Local-first target machine: WSL2 (Linux) on Windows 11 Home, RTX 4070 SUPER 12GB.

| Tool | Installed | Version | Location | WSL access | Windows access | GPU access | Ready for adapter | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NVIDIA GPU | yes | driver reports CUDA UMD 13.3 | n/a | `nvidia-smi` visible in WSL | `nvidia-smi.exe` visible (WDDM) | RTX 4070 SUPER 12GB, both sides | n/a | none |
| Node.js | yes | v24.18.0 | WSL-native (`nvm`) | native | n/a | n/a | yes | none |
| pnpm | yes | 11.17.0 | WSL-native (corepack) | native | n/a | n/a | yes | none |
| ffmpeg | yes | 8.1.2-full_build (gyan.dev) | `C:\Users\Matt\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` | invokable as `ffmpeg.exe` via PATH interop | native Windows binary | not exercised (no GPU encode used) | **yes — implemented** | none |
| Ollama | yes | 0.32.6 | `C:\Users\Matt\AppData\Local\Programs\Ollama\ollama.exe`, service on `localhost:11434` | invokable as `ollama.exe` via PATH interop; HTTP API reachable from WSL | native Windows service | models report `vision` capability where applicable | **yes — implemented** (`VisionQcAdapter`, model `qwen3.5:9b`) | none |
| Blender | no | — | not found (Program Files, Start Menu, winget, registry App Paths all checked) | — | — | — | no | not installed; deprioritized — Game department's real adapters target Summer first (see below), not Blender directly |
| Godot | no | — | not found (same checks) | — | — | — | no | not installed; primary Game-department engine, reached via Summer (not a direct V31M4 adapter) once Summer is installed and validated |
| Unreal | no | — | not found | — | — | — | no | not installed; explicitly out of scope for now, per `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md` |
| Summer | no | — | not found (no prior reference to it anywhere in this repository or on this machine) | — | — | — | no | not installed; primary execution platform for Game department real adapters (`GameDept_Port -> SummerAdapter -> Summer MCP/CLI -> SummerEngine/Godot`) — see `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`. No adapter is implemented yet. |
| ComfyUI | no | — | not found | — | — | — | no | not installed; requires model download(s) |
| Python (Windows) | yes | 3.14 / 3.13 present | `C:\Python314`, `C:\Users\Matt\AppData\Local\Programs\Python\Python313` | via `.exe` interop | native | n/a | n/a | not currently required by any adapter |

Ollama models installed at discovery time (`ollama list` / `/api/show` capabilities):
`huihui_ai/mistral-small-abliterated:24b` (completion, tools), `qwen3:8b` (completion, tools,
thinking), `gemma3:12b` (completion, **vision**), `qwen3:14b` (completion, tools, thinking),
`devstral-small-2:24b` (completion, **vision**, tools), `qwen2.5-coder:14b` (completion, tools,
insert), `qwen3.5:9b` (completion, **vision**, tools, thinking). Three installed models
(`gemma3:12b`, `devstral-small-2:24b`, `qwen3.5:9b`) report real `vision` capability.
`OllamaVisionQcAdapter` is wired to and validated against `qwen3.5:9b` (see "Real adapter
evidence" below); `gemma3:12b` and `devstral-small-2:24b` are configurable via the same adapter's
`model` option but have not been exercised.

WSL↔Windows interop verified empirically: a Windows-native `ffmpeg.exe`, invoked from WSL, reads and
writes WSL-native filesystem paths (e.g. `/tmp/...`) directly with no manual path translation
required in this WSL2 configuration.

## Execution status in this environment (accurate)

- **Executed and passing here:** the departments' deterministic *reference* adapters and their
  orchestration/lifecycle/recovery/verification tests (department-host 12, Video 7, 3D/Game 8,
  integration 2). These use no external executables and prove the workflow, caching, checkpoint/
  resume, output verification, and removability.
- **Executed and passing here (real tools, 2026-08-09):**
  - `FfmpegAssemblyAdapter` (`plugins/video-production/src/ffmpeg-assembly-adapter.ts`) against the
    real Windows `ffmpeg.exe` described above, invoked from WSL.
  - `OllamaVisionQcAdapter` (`plugins/video-production/src/ollama-vision-qc-adapter.ts`) against the
    same real `ffmpeg.exe` (frame extraction) and a real inference call to the real, installed
    Ollama model `qwen3.5:9b`, GPU-loaded on the RTX 4070 SUPER 12GB.

  See "Real adapter evidence" below for both.
- **NOT executed here, and deferred:** Blender, Godot, Unreal, Summer, ComfyUI, and any real
  image/video *generation* model. None of these are installed on this machine, and installing them
  is a material user choice (large downloads / licensing), so they were not installed automatically
  per the operating contract. The adapters that would drive them remain defined as replaceable
  interfaces with only their deterministic reference implementation: Video's
  `ShotGenerationAdapter` (needs ComfyUI or a local generation model — no installed Ollama model
  does video/image generation, only text/vision) and all of 3D/Game's
  `AssetAdapter`/`SceneBuildAdapter`/`SceneValidationAdapter`/`PackageAdapter`. Per
  `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`, the Game
  department's real adapters now target Summer (reaching Godot through Summer's MCP/CLI) as the
  primary execution platform — direct Blender/Unreal adapters and any custom Godot agent bridge are
  explicitly out of scope until that path is real and validated.

## Real adapter evidence — Video `AssemblyAdapter` (ffmpeg)

- **Tool:** ffmpeg
- **Exact version:** `ffmpeg version 8.1.2-full_build-www.gyan.dev` (libx264 encoder enabled)
- **Executable/service location:** `C:\Users\Matt\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`,
  invoked from WSL as `ffmpeg.exe` (resolved via the Windows PATH entries already present in the
  WSL environment; no reinstall inside WSL)
- **OS/environment:** WSL2 (Linux) on Windows 11 Home; ffmpeg itself runs as a native Windows
  process
- **GPU used:** no (CPU libx264 encode of a trivial fixture; GPU-accelerated encode was not
  exercised — not required by this adapter's contract)
- **Adapter exercised:** `FfmpegAssemblyAdapter` implementing `AssemblyAdapter`
  (`plugins/video-production/src/ffmpeg-assembly-adapter.ts`)
- **Command invoked (representative, argument array, no shell):**
  `ffmpeg.exe -y -i <shot-a>.mp4 -i <shot-b>.mp4 -filter_complex "[0:v:0][1:v:0]concat=n=2:v=1:a=0[outv]" -map [outv] -pix_fmt yuv420p <output>.mp4`
- **Test/workload:** two 64x64, 1-second, 5fps `color` lavfi fixtures (red, blue), `-preset
  ultrafast`; concatenated into one output
- **Produced artifact:** a temporary `production-evidence.mp4` (1,875 bytes) written to a scratch
  directory during evidence capture (not committed — evidence, not a fixture)
- **Artifact hash (SHA-256):**
  `88993a7cd5c4b0e93824169b294e62aadcdf7aec5a6f547d62f397cc9a591bf2` (64 hex chars, via
  `sha256sum` on the produced file). The adapter's own `outputRef` is computed the same way
  (`createHash("sha256")` over the real output bytes) and is asserted equal to the
  independently-recomputed hash of the file on disk in the automated test
  (`ffmpeg-assembly-adapter.target-host.test.ts`, first test case).
- **Result:** pass — real ffmpeg executed, real output file produced, non-empty, `outputRef` equals
  the SHA-256 of the real output bytes, `checksum` equals `contentHash({shotRefs, kind:"checksum"})`
  exactly as `VideoDepartment` independently recomputes and verifies it.
- **Failure-path result:** pass — three real-failure scenarios verified: (1) a missing shot media
  file is rejected with `DEPENDENCY_FAILURE` before ffmpeg is invoked, no output file produced; (2) a
  shot file that exists but is not decodable media causes ffmpeg to actually run and actually exit
  non-zero, surfaced as `DEPENDENCY_FAILURE` with the captured stderr tail, no output file produced;
  (3) an invalid ffmpeg executable path fails to spawn (`ENOENT`), surfaced as `DEPENDENCY_FAILURE`.
  A pre-aborted `CancellationSignal` is honored (`CANCELLED`, ffmpeg never invoked, no output file).
- **Timing:** end-to-end real ffmpeg concat of the two-shot fixture completed in ~104ms on this
  machine (CPU encode, trivial content); the full automated real-ffmpeg test file (5 tests, real
  process spawns) completes in ~1.4s including the reference-adapter tests in the same run.
- **Limitations:** video-only concat (no audio streams); `outputRef` is the hash of ffmpeg's actual
  encoded bytes, which is **not** guaranteed bit-identical across ffmpeg versions/builds/encoder
  settings — this is expected and matches the documented contract-parity requirement ("if the real
  tool is non-deterministic, the adapter must compute the content reference from the actual output
  bytes"); `checksum` (the value `VideoDepartment` verifies) is unaffected because it is computed
  from shot identity, not media bytes. Real per-shot generation (`ShotGenerationAdapter`) is still
  the reference adapter — this adapter only proves real `AssemblyAdapter` execution; its fixtures in
  the automated test are synthetic ffmpeg-generated clips, not real generated shots.
- **How to reproduce:** `V31M4_TARGET_HOST=1 pnpm --filter @v31m4/video-production test` — the real
  tests are gated behind `V31M4_TARGET_HOST=1` and skip cleanly (not silently pass) when unset or
  when no `ffmpeg`/`ffmpeg.exe` is resolvable on `PATH`.

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
- The external tools under test, on `PATH`: ffmpeg; Summer (Game department's primary execution
  platform, reaching Godot through Summer's own MCP/CLI — see
  `docs/superpowers/specs/2026-08-09-game-department-summer-engine-boundary.md`); ComfyUI or the
  chosen generation backend; the chosen vision-QC model endpoint. GPU as required. Direct
  Blender/Unreal adapters are out of scope for now.

Process boundary (verified approach, as implemented by both real adapters): a **department
plugin's runtime code must not gain `@v31m4/infrastructure` as a runtime dependency** — that
package remains a test/dev-only dependency, preserving the verified dependency direction (core →
nothing from departments; departments → `@v31m4/application` + `@v31m4/department-host` only; see
`docs/reviews/post-core-program-status.md`, Phase D). Layer 8's `ProcessSupervisor`/`JsonRpcClient`
are therefore **not** used by department adapters; they remain available inside
`packages/infrastructure` for the core's own supervised long-lived adapter processes. Instead, a
real one-shot external-tool adapter spawns via `node:child_process` directly, with an **argument
array (never a shell string)**, and implements timeout, cancellation (`context.signal`), stderr
capture, and fail-closed `DEPENDENCY_FAILURE`/`CANCELLED` classification itself. This logic is
shared, not duplicated, across a plugin's adapters via a small internal helper — see
`plugins/video-production/src/internal/run-external-process.ts`, used by both
`FfmpegAssemblyAdapter` and `OllamaVisionQcAdapter`. A network-based tool (e.g. Ollama's HTTP API)
uses the platform `fetch`/`AbortController` directly, under the same cancellation/timeout/
fail-closed discipline, with no process boundary needed at all.

Steps:
1. Clone the repo at the tag/commit under validation and `pnpm install --frozen-lockfile`.
2. Implement the production adapter behind the existing interface (in the owning
   `plugins/*/src` package), following the process boundary above. Do **not** modify the department
   orchestrators or the frozen core, and do **not** add `@v31m4/infrastructure` as a runtime
   dependency of the plugin.
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

## Real adapter evidence — Video `VisionQcAdapter` (ffmpeg frame extraction + Ollama vision model)

- **Tools:** ffmpeg (frame extraction, same binary/version as above) and Ollama
- **Exact Ollama version:** `0.32.6`
- **Model:** `qwen3.5:9b` (already installed; reports `vision` capability via `/api/show`; no
  download performed)
- **Executable/service location:** `C:\Users\Matt\AppData\Local\Programs\Ollama\ollama.exe`,
  server reachable from WSL at `http://localhost:11434`
- **OS/environment:** WSL2 (Linux) on Windows 11 Home; Ollama runs as a native Windows service
- **GPU used:** yes — RTX 4070 SUPER 12GB (model loaded into VRAM for inference)
- **Adapter exercised:** `OllamaVisionQcAdapter` implementing `VisionQcAdapter`
  (`plugins/video-production/src/ollama-vision-qc-adapter.ts`)
- **Command/API invoked:** `ffmpeg.exe -y -i <shot>.mp4 -frames:v 1 -f image2 <frame>.png` (real
  argument-array spawn) followed by `POST http://localhost:11434/api/generate` with the extracted
  frame base64-encoded in `images`, `format: "json"`, `think: false`
- **Test/workload:** one 64x64, 1-second `color=red` lavfi fixture; one real frame extraction; one
  real model inference call
- **Produced artifact:** the extracted PNG frame (temporary, deleted after inspection per the
  adapter's isolation contract — QC output is a verdict, not a persisted artifact)
- **Result:** pass — real ffmpeg frame extraction executed, real HTTP call to the real Ollama
  server executed, real model inference executed on GPU, response parsed into a well-shaped
  `QcReport` (`passed: boolean`, `findings: {kind, detail}[]`), validated by the automated test
  before being trusted.
- **Real judgment observed (evidence, not a correctness claim about the model):** for the solid-red
  fixture with prompt `"a plain solid red square"`, the model returned
  `{"passed": false, "findings": [{"kind": "blank_or_solid_noise_frame", "detail": "The image shows
  a plain red square without any variation in color or noise."}]}` — a real, structurally valid
  verdict; the QC prompt explicitly lists "blank/solid-noise frame" as a defect category, so a flat
  solid-color test fixture triggering that finding is expected model behavior, not an adapter bug.
- **Failure-path result:** pass — four real-failure scenarios verified: (1) a missing shot media
  file is rejected with `DEPENDENCY_FAILURE` before ffmpeg or Ollama is invoked; (2) a shot file
  that exists but is not decodable media causes a real ffmpeg failure, surfaced as
  `DEPENDENCY_FAILURE`; (3) an unreachable Ollama endpoint (`http://127.0.0.1:1`) causes a real
  connection failure, surfaced as `DEPENDENCY_FAILURE`; (4) a pre-aborted `CancellationSignal` is
  honored (`CANCELLED`, neither ffmpeg nor Ollama invoked).
- **Timing:** first real inference (model cold, before this session had run it) took ~18s
  end-to-end including model load into VRAM; a subsequent real inference against the same loaded
  model completed in ~0.9s (`total_duration` ≈ 868ms per Ollama's own reporting, `eval_count`: 42
  tokens). The full automated real-adapter test file (5 tests, exactly one real model inference
  call) completes in ~2-3s once the model is already loaded, ~18-20s on a cold model.
- **Root-cause fix applied:** the initial implementation used `format: "json"` without `think:
  false`. `qwen3.5:9b` is a reasoning ("thinking") model; Ollama's `format: "json"` grammar
  constraint applies to the hidden reasoning tokens too, so the model consumed its entire output
  budget "thinking" and returned an empty `response` field, which the adapter correctly rejected as
  `DEPENDENCY_FAILURE` (fail-closed — no silent false pass). Root cause was confirmed by direct
  `curl`/`urllib`-equivalent reproduction against the real Ollama API outside the adapter before the
  fix was applied. Adding `"think": false` to the request body resolves it; the adapter now sets
  this by default.
- **Limitations:** only `qwen3.5:9b` was exercised end-to-end; `gemma3:12b` and
  `devstral-small-2:24b` also report vision capability and are configurable via the adapter's
  `model` option but were not run here (avoiding multiple large-model GPU loads in one validation
  pass, per the resource-aware constraint). The model's QC judgment is inherently non-deterministic
  across runs/models — the adapter does not assert a specific verdict, only that the verdict is
  well-shaped and fails closed on any malformed/unreachable/undecodable input. No real
  `ShotGenerationAdapter` exists yet, so this was validated against synthetic ffmpeg-generated
  fixtures, not real generated shots.
- **How to reproduce:** `V31M4_TARGET_HOST=1 pnpm --filter @v31m4/video-production test` (optionally
  `V31M4_OLLAMA_VISION_MODEL=<model>` and `V31M4_OLLAMA_BASE_URL=<url>` to target a different
  installed vision model or a different Ollama host). Skips cleanly if `V31M4_TARGET_HOST=1` is
  unset, ffmpeg is unresolvable, the Ollama server is unreachable, or the target model is not
  installed.

## Honesty rule

Never state that a real external tool or model was executed unless it was actually executed on a
target host and the evidence above was recorded.

Current, accurate status of this repository (2026-08-09):

- **Actually executed and evidenced:** ffmpeg (via `FfmpegAssemblyAdapter` and, for frame
  extraction, `OllamaVisionQcAdapter`) and Ollama's `qwen3.5:9b` vision model (via
  `OllamaVisionQcAdapter`) — see "Real adapter evidence" above for both.
- **NOT executed here, and not to be claimed as executed:** Blender, Godot, Unreal, Summer,
  ComfyUI, any real image/video generation model, and any Ollama vision model other than
  `qwen3.5:9b` (`gemma3:12b` and `devstral-small-2:24b` are installed and vision-capable but
  unexercised).
