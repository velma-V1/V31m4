# V31M4 Repository Ownership Map

## Current implemented ownership

| Path | Owner | Responsibility |
|---|---|---|
| `/AGENTS.md` | Repository governance | Mandatory human and AI contribution rules |
| `/repo_map.md` | Repository governance | Exact current implementation state |
| `/docs` | Architecture governance | Source-of-truth architecture and implementation planning |
| `/packages/domain` | Domain core | Dependency-free value objects, errors, and events |
| Root configuration | Build governance | Workspace, compiler, lint, test, and build orchestration |

## Current dependency graph

```text
Root tooling
    ↓
packages/domain tests
    ↓
packages/domain source
```

`packages/domain` imports no other workspace package.

## Update rule

Every layer must update this ownership map and the root `repo_map.md` in the same commit. A path may not be added without an owner and one strict responsibility.
