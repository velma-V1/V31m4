# V31M4 Layers 1-5 Improvement Ledger

## L5-001: Avatar evidence subject mismatch

| Field | Record |
|---|---|
| Layer | 5 |
| Location | `packages/application/src/services/avatar-unlock-engine.ts` |
| Severity | High |
| Weakness | The first implementation accepted any evidence ID referenced by a capability score, even when the evidence subject was unrelated to that capability. |
| Evidence | A capability profile referencing passing acceptance-criterion evidence could satisfy an avatar achievement. |
| Consequence | Cosmetic progression could be unlocked without proof of the capability named by the achievement rule. |
| Decision | Fixed |
| Correction | Require every accepted unlock record to be passed evidence with `subjectType === "capability"` and `subjectId` matching the required capability. |
| Test added | `avatar-unlock-engine.test.ts`: rejects evidence bound to a different subject. |
| Focused result | 4 avatar engine tests passed. |
| Regression result | 168 Layer 1-5 checks passed across 39 test files. |
| Remaining risk | Future revocation semantics are not part of the current immutable evidence model. |

## Investigated and rejected

- Replacing deterministic service functions with stateful classes was rejected because it added no verified capability and increased hidden-state risk.
- Importing external contract schemas into services was rejected because Layer 4 established that external payload translation belongs at runtime boundaries.
- Using model confidence or model size in champion selection was rejected because neither is verification evidence.
