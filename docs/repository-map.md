# V31M4 Repository Ownership Map

## Current implemented ownership

| Path | Owner | Responsibility |
|---|---|---|
| `/AGENTS.md` | Repository governance | Mandatory human and AI contribution rules |
| `/repo_map.md` | Repository governance | Exact current implementation state |
| `/docs` | Architecture governance | Source-of-truth architecture and implementation planning |
| `/packages/domain/src/value-objects` | Domain core | Canonical validated primitive values |
| `/packages/domain/src/entities` | Domain core | Immutable entities, invariants, decisions, and lifecycle transitions |
| `/packages/domain/src/domain-errors.ts` | Domain core | Typed domain failures |
| `/packages/domain/src/domain-events.ts` | Domain core | Immutable JSON-compatible domain events |
| `/packages/domain/src/index.ts` | Domain core | Public domain package API only |
| `/packages/domain/tests` | Domain verification | Layer 1 regression and Layer 2 behavior verification |
| Root configuration | Build governance | Workspace, compiler, lint, test, and build orchestration |

## Current dependency graph

```text
Root tooling
    ↓
packages/domain tests
    ↓
packages/domain public API
    ↓
domain entities
    ↓
domain value objects, errors, and events
```

`packages/domain` imports no other workspace package.

## Domain entity ownership

| Entity group | Files | Strict responsibility |
|---|---|---|
| Project definition | `project.ts`, `requirement.ts`, `mission-contract.ts` | Project and mission intent, constraints, and acceptance |
| Durable execution | `job.ts`, `checkpoint.ts` | Recoverable lifecycle and immutable checkpoints |
| Traceability | `artifact.ts`, `evidence-record.ts`, `claim.ts`, `production-twin.ts` | Content lineage, evidence, claims, and requirement-output links |
| Capability registry | `capability-profile.ts`, `model-profile.ts`, `tool-profile.ts`, `plugin-profile.ts` | Measured capability and availability state |
| Competitive solving | `solver-candidate.ts`, `verification-result.ts`, `issue-record.ts`, `repair-record.ts` | Candidate lineage, verification, defects, and repair evidence |
| Verified delivery | `champion-decision.ts`, `delivery-receipt.ts` | Champion/no-solution decisions and final coverage receipts |
| Improvement | `training-packet.ts`, `practice-task.ts`, `promotion-record.ts`, `avatar-state.ts` | Quarantine, practice, promotion, and evidence-backed visual progression |

## Update rule

Every layer must update this ownership map and the root `repo_map.md` in the same commit. A path may not be added without an owner and one strict responsibility.
