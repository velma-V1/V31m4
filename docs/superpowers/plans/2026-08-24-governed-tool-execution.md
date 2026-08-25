# Governed Tool Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Item 4 by exposing real filesystem, Git, command, and browser operations through V31M4's existing governed `ToolGatewayPort` path, with policy, audit, artifacts, containment, cancellation, and restart-safe behavior.

**Architecture:** Reuse `ToolGatewayPort`, `invokeTool`, `SupervisedToolGateway`, `SupervisedAdapterProcess`, mission resource budgets, and the authoritative runtime composition. Add one runtime tool surface and one supervised local general-tool adapter; do not create a second execution authority. Hermetic tests use a deterministic reference tool gateway; target-host tests exercise the real supervised adapter.

**Tech Stack:** TypeScript 7, Node 22+, pnpm 11.17, Vitest, SQLite, existing JSON-RPC supervised adapter host, Playwright for browser operations.

**Spec:** `docs/superpowers/specs/2026-08-24-full-system-reliability-design.md`

## Global Constraints

- Domain remains infrastructure-free.
- Application source imports only public domain/application-local APIs.
- External effects never run inside authoritative SQLite transactions.
- Every state-changing tool action passes existing policy/approval authorization before invocation.
- Models never directly invoke filesystem, Git, command, browser, MCP, or external tool providers.
- Tool results/logs are promoted through runtime-owned artifact/evidence boundaries rather than adapter-owned SQLite state.
- Production paths are contained to an explicit project/workspace root.
- Unsupported operations and malformed paths fail closed.
- Video/Game departments remain untouched.

---

### Task 1: Add remote verification gate for this branch

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `package.json` scripts.
- Produces: reproducible `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` evidence on pull requests and non-main feature pushes.

- [ ] **Step 1: Add the workflow**

Use Node 22 and pnpm 11.17.0. Cache the pnpm store through `actions/setup-node`. Run install, typecheck, test, and lint as separate named steps so failures are attributable.

- [ ] **Step 2: Open a draft PR and confirm the unchanged branch is green**

Expected: baseline passes before feature tests are added. Any pre-existing failure blocks implementation and must be recorded rather than attributed to Item 4.

### Task 2: Write the failing runtime vertical-slice tests

**Files:**
- Create: `apps/runtime/tests/governed-tool-execution.test.ts`

**Interfaces:**
- Consumes: `buildComposition`, project/mission/job repositories, existing tool contracts/use case, `CompositionOverrides` test seam.
- Produces: acceptance tests for `tool.list` and `tool.invoke` runtime behavior.

- [ ] **Step 1: Write a test proving a running job can invoke an allowlisted deterministic tool through the runtime**

The test must fail because no tool runtime surface is currently registered.

- [ ] **Step 2: Write a policy-refusal test**

A non-authorized actor or operation must be denied before the gateway is called.

- [ ] **Step 3: Write a resource-budget test**

The runtime must load the job's mission and derive the `ToolInvocationRequest.resourceBudget` from the authoritative mission rather than trusting caller-supplied budget data.

- [ ] **Step 4: Write an audit-result test**

Completed, failed, and cancelled invocations must produce durable audit outcomes through the existing `invokeTool` use case.

- [ ] **Step 5: Push only the tests and verify RED in CI**

Expected: tests fail for the missing runtime tool composition/surface, not for syntax or fixture errors.

### Task 3: Compose the existing governed tool path into the runtime

**Files:**
- Create: `apps/runtime/src/tool-command-surface.ts`
- Modify: `apps/runtime/src/composition-root.ts`
- Modify: `apps/runtime/src/list-query-surface.ts` only if tool listing cannot reuse its existing pattern cleanly.
- Test: `apps/runtime/tests/governed-tool-execution.test.ts`

**Interfaces:**
- Consumes: `ToolGatewayPort`, `invokeTool`, `invokeToolRequestSchema`, `invokeToolResponseSchema`, `listToolsRequestSchema`, `listToolsResponseSchema`, mission/job repositories, policy/approval/audit/clock.
- Produces: authoritative `tool.invoke` command and `tool.list` query registration.

- [ ] **Step 1: Add a test-only tool-gateway override seam**

Extend `CompositionOverrides` with a provider-neutral `toolGateway?: ToolGatewayPort`; it must never be configurable from environment or HTTP input.

- [ ] **Step 2: Implement `tool.list`**

Validate the existing list contract, consume gateway pagination safely, apply filters before response pagination where required by existing runtime rules, and return the existing contract shape.

- [ ] **Step 3: Implement `tool.invoke`**

Validate the external request, load authoritative job + mission, reject missing/non-running jobs, create a runtime invocation ID/audit ID, inject the mission resource budget, call existing `invokeTool`, and translate the provider-neutral result into the existing response contract.

- [ ] **Step 4: Add fail-closed policy rules for general tools**

Read-only inspection operations may be allowed for the local operator; state-changing command/filesystem/Git/browser effects require the action-specific policy decision and optional approval exactly as `invokeTool` already enforces.

- [ ] **Step 5: Run focused and full CI**

Expected: governed-tool runtime tests green; existing approval/idempotency/architecture tests remain green.

### Task 4: Add runtime-owned artifact promotion for general tool outputs

**Files:**
- Create: `apps/runtime/src/supervised/tool-artifact-bridge.ts`
- Test: `apps/runtime/tests/governed-tool-execution.test.ts`

**Interfaces:**
- Consumes: `ArtifactStorePort`, unit-of-work, supervised staging root.
- Produces: hash-verified runtime-owned artifact IDs for tool stdout/stderr/results and output files.

- [ ] **Step 1: Write failing tests for staged output promotion**

Prove adapters cannot manufacture authoritative artifact IDs and that promoted bytes are re-read/hash-verified before persistence.

- [ ] **Step 2: Implement bounded promotion**

Only files inside the invocation staging directory may be promoted. Reject traversal, symlink escape, missing outputs, unexpected output count, and oversized logs.

- [ ] **Step 3: Verify artifact durability across runtime restart**

Read the resulting artifact by ID after closing and reopening the runtime against the same database/artifact root.

### Task 5: Implement the real supervised local general-tool adapter

**Files:**
- Create: `adapters/local-supervised/general-tool-adapter.mjs`
- Modify: `apps/runtime/src/supervised/local-execution-composition.ts`
- Create: `apps/runtime/tests/supervised-general-tool.test.ts`

**Interfaces:**
- Consumes: existing `rpc-host.mjs`, `SupervisedAdapterProcess`, `SupervisedToolGateway`.
- Produces: one replaceable supervised tool worker exposing bounded semantic operations.

- [ ] **Step 1: Write RED tests for filesystem inspection and bounded command execution**

Operations:
- `filesystem.read`
- `filesystem.list`
- `command.run`

Tests must prove root containment, timeout/cancellation, bounded stdout/stderr, no shell-string interpolation, and explicit exit status.

- [ ] **Step 2: Implement filesystem operations**

Resolve all paths relative to the configured project/workspace root; reject absolute paths, `..` escape, symlink escape, device paths, and oversized reads.

- [ ] **Step 3: Implement command execution**

Accept executable + argument array, never a shell command string. Enforce allowlist/policy metadata, cwd containment, timeout, cancellation, and output limits.

- [ ] **Step 4: Write RED tests for Git operations**

Operations:
- `git.status`
- `git.diff`
- `git.history`

- [ ] **Step 5: Implement Git operations through argument-array CLI calls**

No arbitrary Git subcommand passthrough. CWD must be contained. Mutating Git operations are deferred to the semantic tool layer unless separately approved by policy.

- [ ] **Step 6: Write RED tests for browser inspect/verify**

Operations:
- `browser.inspect`
- `browser.verify`

- [ ] **Step 7: Implement browser operations through Playwright**

Use explicit URL policy, bounded navigation timeout, bounded captured content, isolated browser context per invocation, and guaranteed close in `finally`.

- [ ] **Step 8: Compose the worker into `LocalExecutionComposition`**

Expose its `ToolGatewayPort` to the authoritative runtime; keep the existing verifier tool separate so the verifier cannot become the general tool authority.

### Task 6: Prove restart-safe failure semantics

**Files:**
- Test: `apps/runtime/tests/supervised-general-tool.test.ts`
- Modify: runtime tool surface/adapter only if the tests expose a defect.

**Interfaces:**
- Produces: evidence that interrupted or failed tool invocations cannot be mistaken for completed effects.

- [ ] **Step 1: Add interrupted invocation test**

Kill/stop the supervised child during a bounded invocation and restart the runtime.

- [ ] **Step 2: Assert no fabricated success**

The durable audit/result state must be failed/inconclusive, never completed without output artifacts.

- [ ] **Step 3: Assert safe retry**

A retry uses a new invocation identity unless the command contract explicitly proves idempotent replay; duplicate external command keys must still obey existing runtime idempotency rules.

### Task 7: Architecture/documentation reconciliation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`
- Modify: `docs/current-state.md`

**Interfaces:**
- Produces: exact ownership/current-state evidence for the new runtime surface and supervised worker.

- [ ] **Step 1: Update ownership maps**

Record `tool-command-surface.ts`, `tool-artifact-bridge.ts`, and `general-tool-adapter.mjs` with one strict responsibility each.

- [ ] **Step 2: Record verification evidence**

Include focused test counts, full gate result, restart proof, negative-policy proof, and any target-host limitations.

- [ ] **Step 3: Run the complete gate**

Run `pnpm check` and `pnpm build`. Do not mark Item 4 complete unless all are green.

## Item 4 acceptance threshold

Item 4 is complete only when a real runtime job can invoke filesystem, command, Git-inspection, and browser-inspection operations through the governed `ToolGatewayPort` route; unauthorized/path-escaping/over-budget/timeout cases fail closed; outputs are runtime-owned artifacts; audit/evidence survives restart; and the full repository gate remains green.