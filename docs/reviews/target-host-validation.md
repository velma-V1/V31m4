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
| Ollama | yes | 0.32.6 | `C:\Users\Matt\AppData\Local\Programs\Ollama\ollama.exe`, service on `localhost:11434` | invokable as `ollama.exe` via PATH interop; HTTP API reachable from WSL | native Windows service | models report `vision` capability where applicable | not yet — no Video/Game contract wired | see below |
| Blender | no | — | not found (Program Files, Start Menu, winget, registry App Paths all checked) | — | — | — | no | not installed; large/material install |
| Godot | no | — | not found (same checks) | — | — | — | no | not installed; large/material install |
| Unreal | no | — | not found | — | — | — | no | not installed; very large/material install |
| ComfyUI | no | — | not found | — | — | — | no | not installed; requires model download(s) |
| Python (Windows) | yes | 3.14 / 3.13 present | `C:\Python314`, `C:\Users\Matt\AppData\Local\Programs\Python\Python313` | via `.exe` interop | native | n/a | n/a | not currently required by any adapter |

Ollama models installed at discovery time (`ollama list` / `/api/show` capabilities):
`huihui_ai/mistral-small-abliterated:24b` (completion, tools), `qwen3:8b` (completion, tools,
thinking), `gemma3:12b` (completion, **vision**), `qwen3:14b` (completion, tools, thinking),
`devstral-small-2:24b` (completion, **vision**, tools), `qwen2.5-coder:14b` (completion, tools,
insert), `qwen3.5:9b` (completion, **vision**, tools, thinking). Three installed models
(`gemma3:12b`, `devstral-small-2:24b`, `qwen3.5:9b`) report real `vision` capability and are
candidates for a future `VisionQcAdapter`, but no adapter wiring to Ollama exists yet — this is
recorded as capability, not execution.

WSL↔Windows interop verified empirically: a Windows-native `ffmpeg.exe`, invoked from WSL, reads and
writes WSL-native filesystem paths (e.g. `/tmp/...`) directly with no manual path translation
required in this WSL2 configuration.

## Execution status in this environment (accurate)

- **Executed and passing here:** the departments' deterministic *reference* adapters and their
  orchestration/lifecycle/recovery/verification tests (department-host 12, Video 7, 3D/Game 8,
  integration 2). These use no external executables and prove the workflow, caching, checkpoint/
  resume, output verification, and removability.
- **Executed and passing here (real tool, 2026-08-09):** `FfmpegAssemblyAdapter`
  (`plugins/video-production/src/ffmpeg-assembly-adapter.ts`) against the real Windows `ffmpeg.exe`
  described above, invoked from WSL. See "Real adapter evidence" below.
- **NOT executed here:** Blender, Godot, Unreal, ComfyUI, any real image/video generation model, and
  any real vision-QC model (Ollama's vision-capable models are installed but not yet wired to a
  `VisionQcAdapter`). Blender/Godot/Unreal/ComfyUI are not installed on this machine and installing
  them is a material user choice (large downloads / licensing), so they were not installed
  automatically per the operating contract. The production adapters that would drive those tools
  remain defined as replaceable interfaces (`ShotGenerationAdapter`/`VisionQcAdapter` for Video;
  `AssetAdapter`/`SceneBuildAdapter`/`SceneValidationAdapter`/`PackageAdapter` for Game, and
  `AssemblyAdapter` where Blender is the target) but their real implementations are not built.

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
