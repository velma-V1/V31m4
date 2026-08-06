# Contracts and Schema Layer 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the complete versioned, strict, provider-neutral contract boundary for V31M4 runtime APIs, events, adapters, plugins, manifests, evidence, training packets, capability packages, workflows, and avatar achievements.

**Architecture:** `@v31m4/contracts` depends only on `@v31m4/domain` and Zod. Every object schema is strict, every durable identifier is validated by the domain parser, every timestamp is canonical UTC ISO-8601 with milliseconds, every untrusted recursive JSON value is prototype-safe and finite, and every external protocol carries an explicit schema or protocol version. Root JSON Schemas use draft 2020-12 and are validated independently from the TypeScript schemas.

**Tech Stack:** Node.js 22+, pnpm 11.17.0, TypeScript 7.0.2, Zod 4.4.3, Ajv 8.20.0, ajv-formats 3.0.1, Vitest 4.1.10.

## Global Constraints

- Contracts may import only the public API of `@v31m4/domain` and Zod.
- Every object crossing a process or API boundary rejects unknown properties.
- Every contract is versioned with exact semantic-version syntax.
- Provider-specific SDK types may not appear in public contracts.
- Recursive JSON payloads reject non-finite numbers, cycles, non-plain objects, and prototype-pollution keys.
- JSON-RPC methods are an explicit closed set for protocol version `1.0.0`.
- JSON Schemas use `$schema: https://json-schema.org/draft/2020-12/schema` and `additionalProperties: false` for bounded objects.
- Tests are written before production schemas and must demonstrate valid and invalid payloads.
- No placeholder code, deferred schema, permissive `unknown` object, or silent field stripping is permitted.

---

### Task 1: Contract package and common primitives

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/common.schemas.ts`
- Test: `packages/contracts/tests/common.schemas.test.ts`

**Interfaces:**
- Consumes: public domain ID parsers, `ContentHash`, `SafePath`, `Score`, and `ResourceBudget`.
- Produces: version schemas, request metadata, canonical timestamps, branded IDs, safe JSON, pagination, API errors, and reusable strict helpers.

- [x] Write failing tests for canonical timestamps, unknown-field rejection, branded identifiers, bounded pagination, resource budgets, and hostile recursive JSON.
- [x] Verify tests fail because contract schemas do not exist.
- [x] Implement all common schemas and exported inferred types.
- [x] Verify the common schema tests pass.

### Task 2: Runtime resource API contracts

**Files:**
- Create: `packages/contracts/src/projects.schemas.ts`
- Create: `packages/contracts/src/missions.schemas.ts`
- Create: `packages/contracts/src/jobs.schemas.ts`
- Create: `packages/contracts/src/evidence.schemas.ts`
- Create: `packages/contracts/src/capabilities.schemas.ts`
- Test: `packages/contracts/tests/runtime-resources.schemas.test.ts`

**Interfaces:**
- Consumes: common schemas and Layer 2 domain shapes.
- Produces: strict project, mission, job, checkpoint, artifact, evidence, capability, promotion, and delivery payloads.

- [x] Write failing tests covering valid lifecycle payloads and invalid coverage counts, missing evidence, invalid stop modes, duplicate identifiers, and unknown properties.
- [x] Implement resource schemas and public inferred types.
- [x] Verify the resource contract tests pass.

### Task 3: Model, tool, plugin, practice, and avatar contracts

**Files:**
- Create: `packages/contracts/src/models.schemas.ts`
- Create: `packages/contracts/src/tools.schemas.ts`
- Create: `packages/contracts/src/plugins.schemas.ts`
- Create: `packages/contracts/src/practice.schemas.ts`
- Create: `packages/contracts/src/avatar.schemas.ts`
- Test: `packages/contracts/tests/capability-endpoints.schemas.test.ts`

**Interfaces:**
- Consumes: common, capability, artifact, evidence, and job schemas.
- Produces: provider-neutral model/tool invocation, plugin registration, workflow definition, practice control, and avatar state payloads.

- [x] Write failing tests for strict provider neutrality, unique operations, workflow dependency validity, practice isolation, and earned-item equip rules.
- [x] Implement all schemas and semantic workflow validation.
- [x] Verify the endpoint contract tests pass.

### Task 4: Runtime event stream contracts

**Files:**
- Create: `packages/contracts/src/runtime-events.schemas.ts`
- Test: `packages/contracts/tests/runtime-events.schemas.test.ts`

**Interfaces:**
- Consumes: common IDs, timestamps, evidence, capability, job, plugin, practice, and avatar schemas.
- Produces: a discriminated union covering every client-streamable core event in protocol version `1.0.0`.

- [x] Write failing tests for known events, monotonic sequence constraints, strict payloads, event metadata, and unknown event rejection.
- [x] Implement the versioned event envelope and known event variants.
- [x] Verify runtime-event tests pass.

### Task 5: Adapter JSON-RPC contracts

**Files:**
- Create: `packages/contracts/src/adapter-rpc.schemas.ts`
- Test: `packages/contracts/tests/adapter-rpc.schemas.test.ts`

**Interfaces:**
- Consumes: safe JSON, resource budgets, artifact references, model/tool payloads, and common protocol primitives.
- Produces: strict JSON-RPC 2.0 initialize, health, cancellation, shutdown, model, tool, and kernel requests, notifications, success results, and errors.

- [x] Write failing tests for request IDs, closed method sets, success/error exclusivity, protocol versions, cancellation, and malicious params.
- [x] Implement method-specific discriminated unions and response validation.
- [x] Verify adapter-RPC tests pass.

### Task 6: Root JSON Schemas

**Files:**
- Create: `schemas/adapter-manifest.schema.json`
- Create: `schemas/plugin-manifest.schema.json`
- Create: `schemas/workflow.schema.json`
- Create: `schemas/evidence-record.schema.json`
- Create: `schemas/training-packet.schema.json`
- Create: `schemas/capability-package.schema.json`
- Create: `schemas/achievement-rule.schema.json`
- Test: `packages/contracts/tests/json-schemas.test.ts`

**Interfaces:**
- Consumes: draft 2020-12 JSON Schema semantics.
- Produces: independently machine-validatable external files with fixed schema IDs and no unbounded objects.

- [x] Write failing Ajv tests for valid manifests and invalid unknown properties, duplicate IDs, malformed versions, missing evidence, and unsafe command definitions.
- [x] Implement every complete JSON Schema.
- [x] Validate all schemas with Ajv and Python `jsonschema`.
- [x] Verify representative TypeScript and JSON Schema examples agree.

### Task 7: Public API, compatibility, documentation, and repository maps

**Files:**
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/public-api.test.ts`
- Test: `packages/contracts/tests/compatibility.test.ts`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/dependency-rules.md`
- Modify: `docs/repository-map.md`
- Modify: `repo_map.md`

**Interfaces:**
- Consumes: every Layer 3 schema.
- Produces: the single supported contracts package API and exact current repository state.

- [x] Export every schema and inferred type through one public package entrypoint.
- [x] Verify version compatibility behavior and absence of provider-specific types.
- [x] Update architecture and repository maps with exact Layer 3 ownership and verification evidence.
- [x] Run strict source compilation, declaration emission, all Layer 1–3 tests, JSON Schema validation, source-size checks, placeholder scans, and forbidden-dependency scans.
