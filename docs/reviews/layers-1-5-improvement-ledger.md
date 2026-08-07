# V31M4 Layers 1–5 Improvement Ledger

**Branch:** `claude/v31m4-layers-validation-impl-dmlccn` (Layer 5 Application Services, based on `agent/application-ports-layer-4`)
**Starting commit:** `9db51f5dc2dcd2d83cbfe96ebfa7aab897e0d6e8`
**Environment:** Node v22.22.2, pnpm 11.17.0, TypeScript 7.0.2, Vitest 4.1.10, Biome 2.5.6, Zod 4.4.3, Ajv 8.20.0, ajv-formats 3.0.1.

This ledger records the dependency-backed validation of Layers 1–4 against the real
pinned toolchain and every correction made. The prior layer branches were authored in an
environment without npm-registry access (see the original `repo_map.md` note), so no
layer had been type-checked, tested, or linted against its own pinned dependencies until
this branch installed them and ran `pnpm lint/typecheck/test/build`.

## Baseline (unchanged Layer 4 tip, before any edit)

| Command | Result |
|---|---|
| `pnpm install` | success, ~39s, one slow-registry warning (`@vitest/pretty-format`), no peer warnings, lockfile generated |
| `pnpm lint` (`biome ci .`) | **FAIL** — 113 formatting violations + 7 lint infos across the never-formatted tree |
| `pnpm typecheck` | **FAIL** — domain passes; contracts + application fail |
| `pnpm test` | **FAIL** — 3 failed / 136 passed / 139 total (30 files) |
| `pnpm build` | **FAIL** — `@v31m4/application#build` (same compiler invocation as typecheck) |
| `pnpm check` | **FAIL** (cascade) |

## Improvements made

Each correction below is the smallest complete change that resolves a **proven** failure
(a failing command or test), with an explicit red→green cycle.

### IMP-01 — Contract refinement context incompatible with Zod 4.4.3
- **Layer:** 3 — `packages/contracts/src/common.schemas.ts`, `interface ContractRefinementContext`
- **Severity:** Critical (blocks `pnpm typecheck` and `pnpm build` for `@v31m4/contracts`)
- **Weakness:** `ContractRefinementContext.addIssue` typed its `issue.path` as
  `readonly (string | number)[]`. Zod 4.4.3's real `$RefinementCtx.addIssue` expects a
  mutable `PropertyKey[]`, so Zod's context is not assignable to the hand-rolled
  interface at every `addDuplicateStringIssue`/`superRefine` call site.
- **Evidence:** `tsc` emitted ~40 `TS2345` errors across `avatar/capabilities/evidence/jobs/missions/models/plugins.schemas.ts` (e.g. `src/avatar.schemas.ts(27,48)`), all of the form
  “Argument of type `$RefinementCtx<…>` is not assignable to parameter of type `ContractRefinementContext`”.
- **Consequence:** The contracts package cannot compile, so the whole workspace typecheck/build fails; declaration emission is impossible.
- **Correction:** Change `readonly path?: readonly (string | number)[]` → `readonly path?: (string | number)[]` (one word removed). The helper already passes a fresh mutable array (`[...path]`).
- **Test added / gate:** the type checker itself (`pnpm --filter @v31m4/contracts typecheck`).
- **Focused result:** `tsc --project tsconfig.json --noEmit` → 0 errors (was ~40).
- **Regression result:** full `pnpm typecheck` → `3 successful, 3 total`.
- **Remaining risk:** The hand-rolled context type is still coupled to Zod's internal issue
  shape; a future Zod major could reintroduce drift. Low — pinned dependency, covered by typecheck.

### IMP-02 — JSON-schema test cannot compile or run against Ajv 8.20.0
- **Layer:** 3 — `packages/contracts/tests/json-schemas.test.ts`
- **Severity:** High (blocks contracts typecheck and fails 2 JSON-schema tests)
- **Weakness (a):** `import Ajv2020 from "ajv/dist/2020.js"` is not usable as a type or
  constructor under NodeNext + `verbatimModuleSyntax` (CJS default binds to the module
  namespace); `import addFormats from "ajv-formats"` is likewise not callable.
  **Weakness (b):** `new Ajv2020({ strict: true })` throws on the schemas' legitimate
  `["string","number","boolean","null"]` union types because `allowUnionTypes` is unset.
- **Evidence:** `tsc` errors `TS2709`/`TS2351`/`TS2349` at lines 35–37; and Vitest failures
  “root JSON Schemas › compiles every schema under draft 2020-12” and “… validates strict
  adapter and plugin manifests” with `strict mode: use allowUnionTypes to allow union type keyword`.
- **Consequence:** The seven portable JSON Schemas are never actually compiled/validated in CI.
- **Correction:** `import { Ajv2020 } from "ajv/dist/2020.js"`; `import addFormatsModule from "ajv-formats"; const addFormats = addFormatsModule.default;`; add `allowUnionTypes: true` to the Ajv options. No schema content changed (the union types are valid and intended).
- **Test added / gate:** the existing JSON-schema suite (now compiling and asserting all 7 schemas).
- **Focused result:** `vitest run tests/json-schemas.test.ts` → 4 passed.
- **Regression result:** `@v31m4/contracts` → 33 passed (8 files); full suite 232 passed.
- **Remaining risk:** None material; Ajv/ajv-formats are pinned and now exercised.

### IMP-03 — Strict Zod objects accept a `__proto__` prototype-pollution key
- **Layer:** 3 — `packages/contracts/src/adapter-rpc.schemas.ts` (+ new `packages/contracts/src/forbidden-key-guard.ts`)
- **Severity:** High (security; a failing regression test already existed)
- **Weakness:** Zod 4.4.3 `z.object(...).strict()` does **not** reject an own `__proto__`
  key materialized by `JSON.parse` (it rejects a normal unknown key such as `evil`). The
  adapter JSON-RPC message boundary therefore accepted prototype-pollution property names,
  violating the architecture rule that external messages are prototype-safe.
- **Evidence:** existing test “adapter JSON-RPC contracts › rejects prototype-pollution data
  in params …” was **red** at baseline. Reproduced directly: `z.object({invocationId:z.string()}).strict().safeParse(JSON.parse('{"invocationId":"x","__proto__":{}}')).success === true` while the same schema rejects `{"evil":1}`.
- **Consequence:** A malicious adapter message could smuggle a `__proto__` payload through the
  strict RPC contract at the most security-sensitive external boundary.
- **Correction:** Added `guardForbiddenKeys` (in a focused `forbidden-key-guard.ts` module) that
  pipes raw input through a recursive forbidden-property-name check before object parsing,
  and wrapped `adapterRpcMessageSchema` with it. `FORBIDDEN_JSON_KEYS` moved to the same
  module (shared with `common.schemas.ts`) to keep `common.schemas.ts` under 500 lines.
- **Test added / gate:** existing `adapter-rpc.schemas.test.ts` proto test (red→green demonstrated).
- **Red→green evidence:** with the guard removed the test fails (`1 failed | 3 passed`); with it restored `4 passed`.
- **Regression result:** `@v31m4/contracts` → 33 passed; full suite 232 passed.
- **Remaining risk:** Medium/residual — the underlying Zod behavior affects any `.strict()`
  object fed untrusted JSON, not only adapter RPC. Other external boundaries already route
  free-form JSON through `safeJsonObjectSchema` (which rejects `__proto__`). Recommended
  follow-up: apply `guardForbiddenKeys` at the runtime API and event ingress boundaries. See
  Deferred/Residual risks below.

### IMP-04 — Application package cannot type-check (missing `@types/node`)
- **Layer:** 4 — `packages/application/package.json`
- **Severity:** High (blocks `@v31m4/application` typecheck and build)
- **Weakness:** `packages/application/tsconfig.json` sets `"types": ["node"]` and the
  application tests import `node:fs`/`node:path`/`node:url`, but the package declared no
  `@types/node` dependency (the contracts package correctly pins `@types/node@22.20.1`).
- **Evidence:** `tsc` error `TS2688: Cannot find type definition file for 'node'`.
- **Consequence:** The application layer does not compile on a clean install, so Layer 4/5
  typecheck, build, and declaration emission all fail.
- **Correction:** Add `"@types/node": "22.20.1"` to `devDependencies` (matching the contracts pin; no version drift).
- **Focused result:** `pnpm --filter @v31m4/application typecheck` → 0 errors.
- **Regression result:** full `pnpm typecheck` → 3/3; full `pnpm build` → 3/3.
- **Remaining risk:** None; application source imports no Node APIs (enforced by the dependency-boundary test); node types are used only by tests.

## Investigated and rejected (not improvements)

- **Whole-repo Biome formatting non-compliance (LINT):** The committed Layers 1–4 were never
  run through Biome, so `pnpm lint` (`biome ci .`) reports 113 formatting violations on
  files this branch does not otherwise touch. **Rejected as an improvement / deferred**:
  the Improvement Rules forbid changes “when the only justification is preference, style,
  taste,” and the branch rules require keeping unrelated formatting out of the diff.
  Reformatting ~53 untouched files would be a style-only change that buries the Layer 5
  diff. New and substantively-changed files in this branch **are** Biome-clean (`biome ci`
  exits 0 on them). See Deferred risks.
- **`useLiteralKeys` info in `json-schemas.test.ts` (`schema["$id"]`):** genuinely conflicts
  with tsconfig `noPropertyAccessFromIndexSignature` (dot access on a `Record<string,unknown>`
  is a compile error). Info-level; does not fail `biome ci`. Left as-is (bracket access is required).
- **`noControlCharactersInRegex` info in `packages/domain/src/value-objects/safe-path.ts`:**
  the control-character range in the regex is intentional (it rejects control characters in
  paths). Info-level; does not fail `biome ci`. Left as-is.
- **Broadening `guardForbiddenKeys` to every strict contract object:** considered but not done,
  because only the adapter-RPC boundary has a proven failing test and adding it everywhere
  would be a speculative, unmeasured change. Recorded as residual risk instead.

## Deferred / residual risks (kept visible)

1. **Pre-existing Biome formatting debt (Layers 1–4).** `pnpm lint`/`pnpm check` remain red
   solely because ~53 untouched files predate any Biome run. This is not introduced by this
   branch and is the reason the pull request stays a draft. It can be closed by a separate,
   isolated `biome format --write .` commit if maintainers want the whole tree formatted.
2. **Zod `.strict()` `__proto__` behavior (contracts-wide).** IMP-03 fixes the proven adapter-RPC
   boundary; other strict typed objects share the underlying Zod behavior. Follow-up: apply
   `guardForbiddenKeys` at additional untrusted-JSON ingress points.
3. **Performance** was not measured; no performance claim is made anywhere in this work.
