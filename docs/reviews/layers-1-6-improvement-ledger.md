# V31M4 Layers 1–6 Improvement Ledger

## L6-001: Durable practice workspace identity

- **Severity:** High
- **Correction:** Persist and validate the opaque workspace ID; cleanup uses that exact ID.
- **Regression:** Domain lifecycle, contract parity, and idle-practice cleanup tests.

## L6-002: Running practice contract parity

- **Severity:** Medium
- **Correction:** Running practice may precede its first trace; traces become mandatory at checkpoint/completion/quarantine.
- **Regression:** `practice-domain-parity.test.ts`.

## L6-003: External job transaction phasing

- **Severity:** High
- **Correction:** Commit prepared state before kernel calls and finalize success/failure in a new transaction; start returns current running state.
- **Regression:** Job lifecycle and kernel-failure tests.

## L6-004: Authoritative pagination completeness

- **Severity:** High
- **Correction:** Consume all pages, reject repeated cursors, and cap runaway pagination.
- **Regression:** `pagination.test.ts`.

## L6-005: Exact approval expiration

- **Severity:** Medium
- **Correction:** `expiresAt <= now` is expired.
- **Regression:** Exact-expiry authorization test.

## L6-006: Unsafe resume checkpoint selection

- **Severity:** High
- **Correction:** Explicit resume checkpoints must be verified and belong to the requested job.
- **Regression:** Unverified explicit checkpoint rejection.

## L6-007: Finish-stop without recovery state

- **Severity:** High
- **Correction:** Finish-stop requires a verified checkpoint; emergency stop remains available.
- **Regression:** Finish-stop precondition test.
