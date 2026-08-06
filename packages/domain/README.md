# `@v31m4/domain`

This package is the dependency-free authority for V31M4 entities, value objects, invariants, lifecycle transitions, and domain events.

## Allowed dependencies

Domain source may import only other files inside this package and ECMAScript language features. It may not import Zod, Node-specific APIs, persistence, providers, tools, adapters, plugins, applications, or UI code.

## Public API

Consumers import only from `@v31m4/domain`. Internal file paths are not supported APIs.

## Mutation rule

Factories and transitions return frozen values. Existing accepted state is never mutated. Invalid construction or transitions raise `DomainError`.
