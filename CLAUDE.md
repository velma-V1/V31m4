# Claude Code Project Instructions

## Session start

1. Read `docs/current-state.md` first.
2. Verify the current branch, HEAD commit, git status, and active task before repository discovery.
3. Use the repository's architecture and specification documents as the source of truth.
4. Never invent repository state. Verify it from git and the repository.

## Context efficiency

- Do not rescan the entire repository when `docs/current-state.md` already records verified information needed for the task.
- Search before reading large files.
- Read only files and sections relevant to the current task.
- Batch related searches and reads.
- Do not reread unchanged files unless a failure, contradiction, changed interface, or new requirement makes it necessary.
- Prefer targeted diffs and focused inspection over whole-file dumps.
- Do not print entire files or large successful command logs unless required as evidence.
- Use focused tests during implementation; run full repository regression at defined layer or gate checkpoints.

## Architecture discipline

Before changing, adding, moving, renaming, or deleting repository files, follow the repository's existing architecture instructions and source-of-truth order. Do not infer architecture from implementation alone.

- Current canonical contracts and interfaces are authoritative over older/reference branches.
- Old or reference branches may provide behavioral evidence but must not override current architecture.
- Do not create compatibility shims merely to imitate obsolete implementation names.
- Do not restart, redesign, or redo verified work unless evidence requires it.

## Persistent handoff

Update `docs/current-state.md` whenever a meaningful implementation, verification, branch, commit, architecture decision, blocker, or remaining-work state changes.

Before a natural stopping point, usage-limit boundary, or completed checkpoint, update `docs/current-state.md` so another Claude Code session can continue without rediscovering the repository.

Keep `docs/current-state.md` concise, factual, and operational. It is a handoff record, not a second architecture specification.

Record only verified facts, including:

- current branch and HEAD
- current layer/task
- completed and verified work
- work in progress
- important interfaces/contracts already inspected
- decisions already resolved
- known defects/blockers
- areas already inspected that normally do not need rereading
- last verification results
- exact remaining work
- next action
