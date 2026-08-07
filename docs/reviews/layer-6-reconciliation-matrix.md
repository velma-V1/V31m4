# Layer 6 Reconciliation Matrix

**Canonical base:** hardened Layer 5 at `5746e5f2571a08dea3cce0493adeac92ae025135`
**Reference implementation:** superseded Layer 6 at `61e09ee81c73be5a3eda32e0516b35f02386641d`

The reference branch changed 108 hardened domain, contract, port, and service files relative to the canonical Layer 5. Consequently, no use case is accepted byte-for-byte. Useful orchestration is ported selectively; service-composition decisions affected by hardened Layer 5 are redesigned within the existing boundaries.

| Use case | Classification | Preserved behavior | Required correction |
|---|---|---|---|
| create project | Port with correction | policy, approval, audit, atomic creation | hardened approval/port types; exact-expiry rejection; current revisions |
| submit mission | Port with correction | active-project guard and append-only mission | hardened mission invariants and repository signatures |
| plan execution | Redesign boundedly | compute/context/diversity composition | hardened deterministic service inputs, decisions, and rejection semantics |
| start job | Port with correction | prepare → kernel → finalize/fail; return current state | hardened job events, revisions, deadlines, idempotency context |
| checkpoint job | Port with correction | append verified checkpoint and update job | hardened checkpoint evidence and job transition invariants |
| resume job | Port with correction | latest verified checkpoint and phased kernel call | exhaustive checkpoint retrieval, revision conflict behavior |
| stop job | Port with correction | finish-stop versus emergency-stop semantics | checkpoint-before-stop, durable failure, current revision |
| run solver forge | Port with correction | isolated sequential candidate production | hardened model/workspace ports, cleanup failure handling, cancellation |
| verify candidates | Port with correction | independent verifier and evidence persistence | hardened evidence/result invariants and complete failure recording |
| record issues | Port with correction | evidence-backed append/save | hardened issue invariants and optimistic revisions |
| repair candidate | Port with correction | isolated repair and focused/regression verification | hardened candidate/evidence ports; durable failure and cleanup semantics |
| select champion | Redesign boundedly | champion/no-solution persistence | hardened selector evidence, coverage, Pareto, and rejection outputs |
| deliver result | Port with correction | verified receipt including no-solution | hardened delivery coverage and immutable artifact requirements |
| compile training packet | Port with correction | quarantined packet and lineage | hardened leakage, evidence traceability, and packet invariants |
| promote capability | Redesign boundedly | held-out/regression-gated promotion | hardened calculator observations, minimum evidence, atomic profile update |
| run idle practice | Redesign boundedly | safe selection and isolated workspace | hardened selector/resource inputs; opaque durable workspace identity |
| stop idle practice | Port with correction | exact workspace disposal after durable stop | idempotent cleanup contract and revision conflicts |
| evaluate avatar unlocks | Redesign boundedly | evidence-backed permanent unlocks | exhaustive pagination and hardened capability-subject evidence rules |
| register plugin | Port with correction | policy/approval/audit registration | hardened manifest/profile port and collision semantics |
| invoke model | Port with correction | governed gateway invocation and audit | hardened provider-neutral request/result and durable failure audit |
| invoke tool | Port with correction | governed tool invocation and audit | hardened policy/approval/workspace semantics and failure audit |

## Totals

- Accept as-is: 0
- Port with correction: 16
- Redesign boundedly: 5
- Reject as obsolete or incorrect: 0 complete use cases

Rejected techniques from the reference implementation are: whole-commit cherry-pick, superseded Layer 5 dependencies, ambiguous after-commit external execution, first-page-only authoritative reads, approvals valid at exact expiry, and cleanup based only on display paths.
