# V31M4 Dependency Rules

## Foundation/Core Layer 1

### `packages/domain`

Allowed:

- ECMAScript language and standard library features
- Files inside `packages/domain/src`

Forbidden:

- Node-specific filesystem, process, networking, or database APIs
- React, Tauri, Fastify, Drizzle, Zod, provider SDKs, or tool SDKs
- Imports from `apps`, `infrastructure`, `adapters`, `plugins`, or `labs`
- Circular imports
- Imports through another package's internal path

### Root governance and tooling

Root configuration may reference workspace packages and development tools. It must not contain domain behavior.

## Future direction

```text
apps → runtime-sdk / ui-kit / application / infrastructure
infrastructure → application ports / domain / adapter-protocol
application → domain
contracts → domain types
plugins → plugin-sdk / contracts
adapters → adapter-protocol / external SDK
domain → nothing outside domain
```

Architecture checks must reject every reverse dependency.
