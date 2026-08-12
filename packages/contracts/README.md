# `@v31m4/contracts`

This package is the versioned validation boundary between V31M4 processes, applications, plugins, adapters, and clients.

## Rules

- Import only `@v31m4/domain` and Zod from source files.
- Use strict object schemas.
- Reuse domain identifier validation.
- Keep payloads provider-neutral.
- Validate cross-field invariants, not only individual properties.
- Reject unsupported versions and methods.
- Export schemas and inferred types only through `src/index.ts`.

## JSON Schemas

External manifests and portable records are also represented in `/schemas`. Overlapping TypeScript and JSON manifest contracts are protected by parity tests.

`software-production.schemas.ts` owns the strict `1.0.0` project build packet used by the optional
general supervised coding workflow. It accepts only capabilities the current production boundary
implements; broader tool commands are added only with their governed execution implementation.

## Versioning

Read `/docs/contract-versioning.md` before changing an accepted or rejected payload shape.
