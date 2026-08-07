# V31M4 Layers 1-6 Improvement Ledger

## L5-001: Avatar evidence subject mismatch

| Field | Record |
|---|---|
| Layer | 5 |
| Location | `packages/application/src/services/avatar-unlock-engine.ts` |
| Severity | High |
| Weakness | Capability scores could reference passing evidence about an unrelated subject. |
| Evidence | A capability profile referencing acceptance-criterion evidence could satisfy an avatar achievement. |
| Consequence | Progression could unlock without proof of the named capability. |
| Decision | Fixed |
| Correction | Require passed evidence with `subjectType === "capability"` and a matching capability subject ID. |
| Test added | `services/avatar-unlock-engine.test.ts` wrong-subject regression. |
| Remaining risk | Evidence revocation is outside the current immutable evidence model. |

## L6-001: Practice workspace identity was not durable

| Field | Record |
|---|---|
| Layer | 6, with Layer 2 and 3 correction |
| Location | `domain/entities/practice-task.ts`, `contracts/practice.schemas.ts`, idle-practice use cases |
| Severity | High |
| Weakness | Practice tasks stored only a display path, while workspace disposal requires the workspace manager's opaque ID. |
| Evidence | A stopped task could not identify the workspace handle that had to be discarded. |
| Consequence | Isolated practice workspaces could leak and retain generated state. |
| Decision | Fixed |
| Correction | Persist validated `workspaceId`, require it in contracts, and dispose that exact ID after a committed stop. |
| Tests added | Domain practice test, practice-contract parity tests, and idle-practice use-case disposal test. |
| Remaining risk | Infrastructure must make workspace disposal idempotent. |

## L6-002: Practice contract rejected a valid running domain state

| Field | Record |
|---|---|
| Layer | 3 correction during Layer 6 |
| Location | `packages/contracts/src/practice.schemas.ts` |
| Severity | Medium |
| Weakness | The contract required trace artifacts immediately after entering `running`, while the domain creates a running task before any trace exists. |
| Evidence | A valid `PracticeTask.start(...)` failed contract parsing. |
| Consequence | Runtime serialization could reject authoritative domain state. |
| Decision | Fixed |
| Correction | Require trace artifacts only for checkpointed, completed, and quarantined states. |
| Test added | `practice-domain-parity.test.ts`. |
| Remaining risk | Future domain transitions require explicit parity cases. |

## L6-003: Job orchestration depended on ambiguous after-commit timing

| Field | Record |
|---|---|
| Layer | 6 |
| Location | `start-job.ts`, `resume-job.ts`, `stop-job.ts` |
| Severity | High |
| Weakness | Kernel operations ran in `afterCommit` callbacks whose awaiting semantics were not defined, and `startJob` returned a stale queued record after persisting running state. |
| Evidence | Correct results depended on a particular unit-of-work implementation. |
| Consequence | Kernel failures could be lost and callers could receive state inconsistent with storage. |
| Decision | Fixed |
| Correction | Use explicit durable prepare, external invoke, then finalize-or-fail phases. |
| Test added | Job lifecycle and kernel-start failure tests. |
| Remaining risk | Infrastructure must serialize competing job transitions through revisions. |

## L6-004: Authoritative evaluation could silently truncate pagination

| Field | Record |
|---|---|
| Layer | 6 |
| Location | Avatar and idle-practice use cases, `collectPortPages` helper |
| Severity | High |
| Weakness | Fixed first-page limits could omit capability or evidence records. |
| Evidence | Ports expose `nextCursor`, but the original use cases ignored it. |
| Consequence | Unlock or practice decisions could be incorrect at scale. |
| Decision | Fixed |
| Correction | Collect every page, reject repeated cursors, and cap runaway pagination. |
| Test added | Complete-page and repeated-cursor use-case tests. |
| Remaining risk | Runtime APIs may choose smaller page limits, but application evaluation remains complete. |

## L6-005: Approval was valid at its exact expiration instant

| Field | Record |
|---|---|
| Layer | 6 |
| Location | `use-cases/use-case-support.ts` |
| Severity | Medium |
| Weakness | Expiration used a strict less-than comparison. |
| Evidence | An approval with `expiresAt === now` passed validation. |
| Consequence | A privileged action could consume an already expired approval. |
| Decision | Fixed |
| Correction | Treat expiration as invalid when `expiresAt <= now`. |
| Test added | Exact-expiry project authorization test. |
| Remaining risk | Infrastructure clocks must be canonical and monotonic enough for policy use. |

## Investigated and rejected

- Stateful service classes were rejected because they add hidden state without verified capability.
- Importing external contracts into application use cases was rejected because translation belongs at runtime boundaries.
- Parallel solver execution was deferred because deterministic resource arbitration and failure aggregation belong to later runtime scheduling.
- Consuming approvals only after successful external execution was rejected because one-time approval authorizes the attempt, not its provider outcome.
