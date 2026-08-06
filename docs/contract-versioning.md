# V31M4 Contract Versioning

## Current versions

- Runtime API contract version: `1.0.0`
- Runtime event schema version: `1.0.0`
- Adapter protocol version: `1.0.0`
- Root JSON Schema document versions: `1.0.0`

## Compatibility rule

V31M4 currently uses exact-version compatibility. A parser for `1.0.0` accepts only `1.0.0`. It does not silently accept a newer patch, minor, prerelease, or major version.

This strict rule prevents one process from interpreting newly added fields, methods, event variants, or invariants differently from another process. Version negotiation and migrations must be explicit.

## Version changes

A contract version changes when any externally visible validation rule, field, enum value, method, event variant, or semantic invariant changes.

- **Patch:** documentation or generated-description correction that does not change accepted or rejected data.
- **Minor:** additive capability introduced through a separately negotiated version while the prior version remains supported.
- **Major:** removal, rename, type change, stricter validation, changed semantics, or incompatible protocol behavior.

Because objects are strict, adding a field to an existing object changes validation behavior and therefore requires a negotiated version rather than an undocumented patch.

## Schema identity

Every root JSON Schema uses a versioned `$id` under `https://schemas.v31m4.local/<schema-name>/<version>`. Published schema content is immutable. A changed schema receives a new version and a new `$id`.

## Required change process

1. Record an architecture decision describing the compatibility impact.
2. Add the new schema or protocol version without mutating the prior published version.
3. Add positive, negative, and cross-version tests.
4. Add migration or negotiation behavior before any caller emits the new version.
5. Update `repo_map.md`, `docs/repository-map.md`, and contract documentation in the same pull request.
6. Run TypeScript declaration emission, all contract tests, JSON Schema compilation, and parity checks.

## Prohibited behavior

- No silent version coercion.
- No accepting unknown fields for forward compatibility.
- No reusing an old `$id` for changed JSON Schema content.
- No provider-specific extension bag in public model or tool contracts.
- No adapter method outside the negotiated protocol method set.
