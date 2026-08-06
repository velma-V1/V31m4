# V31M4 Contributor Operating Rules

Before changing, adding, moving, renaming, or deleting any repository file, read `/docs/architecture.md`, `/docs/repository-map.md`, `/docs/dependency-rules.md`, and the nearest module README. Do not infer architecture from implementation alone. If implementation conflicts with the architecture documents, stop and report the conflict before modifying files.

## Required workflow

1. Read `docs/repository-specification.md`.
2. Identify the owning layer and package.
3. Confirm every proposed import is permitted by `docs/dependency-rules.md`.
4. Reuse existing interfaces instead of creating parallel abstractions.
5. Write or update tests before production behavior.
6. Run the narrowest relevant checks, then the complete layer checks.
7. Update `repo_map.md` and `docs/repository-map.md` in the same change.
8. Do not mark work complete without recorded verification evidence.

## Non-negotiable boundaries

- Domain code imports no infrastructure, adapters, plugins, applications, or UI.
- UI code never owns authoritative project state.
- Models never certify their own outputs.
- External tools and models are invoked only through typed gateways.
- Production assets are modified only through isolated working copies.
- Accepted evidence and verified checkpoints are immutable.
- Optional tools and plugins must never be required for core startup.
