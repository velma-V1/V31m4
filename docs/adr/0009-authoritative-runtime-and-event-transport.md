# ADR 0009: Authoritative runtime and event transport

Status: accepted

Layer 10 exposes the system as a local-first authoritative runtime under `apps/runtime`. It is composed of
a `node:http` server, local session authentication by constant-time bearer token, typed command/query/event
routes that only translate transport and delegate to a runtime service, an error mapper from
`ApplicationError` codes to HTTP status, startup recovery over the durable log, and a checkpoint-safe
shutdown that checkpoints the write-ahead log before closing.

Every state-changing route runs through one external-command executor and the single SQLite idempotency
authority: actor + key + command type + canonical payload hash identify one durable command, an identical
retry returns the stored result without re-running, a differing type or payload is a conflict, a stale
expected revision is a version conflict that stores no idempotency record, and the operation plus its
idempotency record commit in one serialized transaction. No second idempotency mechanism is introduced.

Committed events are streamed through a durable replay store and a transport-agnostic event-stream
coordinator. A subscription fixes its replay boundary at the latest committed sequence, replays strictly
ordered events after the caller's cursor, then hands off to live delivery for sequences beyond the boundary
— so replay and live never race and never duplicate. A cursor that predates retained history, or a detected
internal gap, yields `refresh_required` rather than an ambiguous resume; a consumer that cannot keep up is
disconnected with an explicit resumable cursor instead of growing memory without bound.

## Event transport: SSE over `node:http`, not a bespoke WebSocket

The approved design named "WebSocket events." The workspace is deliberately zero-runtime-dependency (Node
built-ins plus `node:sqlite`); no `ws` package is present and Node has no built-in WebSocket server handshake.
The runtime therefore binds the event stream over Server-Sent Events on `node:http`, mapping the SSE
`Last-Event-ID` header (and an `afterSequence` query parameter) to the coordinator's replay cursor. SSE gives
ordered, resumable, one-way delivery — exactly the shape of the durable-replay acceptance contract — with no
new dependency and no hand-rolled RFC 6455 framing/masking surface that would add correctness risk without
strengthening the gated contract. The `EventStreamCoordinator` is transport-agnostic: a WebSocket binding
can be added later without touching replay, gap-detection, retention, or bounded-queue semantics. This keeps
the invariant that architecture and efficiency choices must not weaken correctness or verification.
