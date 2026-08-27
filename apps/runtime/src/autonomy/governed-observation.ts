import type { AuthorizedSemanticExecutionPlan, SandboxExecutionResult } from "@v31m4/application";
import { ContentHash, LEDGER_LIMITS, type LedgerResourceFact } from "@v31m4/domain";
import { PRECONDITION_RESOURCE_KINDS } from "./evidence-precondition-catalog.js";

/**
 * What a completed governed read actually established, recorded by the runtime.
 *
 * This is the half of evidence-conditioned effects that makes the gate reachable. A precondition is
 * only meaningful if the governed investigation an agent is sent to perform produces the very facts
 * the later effect consumes — otherwise the agent is told to do work that changes nothing, and the
 * only way past the gate is for somebody to write the facts by hand.
 *
 * Two properties matter.
 *
 * The facts come from the backend, not from the turn. A `code.inspect` result carries the
 * fingerprints the backend computed from bytes it read off disk in the assigned workspace, and
 * those are what get recorded. A model chooses *what* to inspect and can say anything it likes in
 * its summary, but it cannot state what a file contains and have that become an authoritative fact.
 *
 * The mapping is runtime-owned and unconditional. It is applied inside the governed effect
 * recording path rather than by a caller-supplied probe, so no composition can turn it off and
 * quietly leave the gate unsatisfiable.
 */
export function deriveGovernedFacts(
  plan: AuthorizedSemanticExecutionPlan,
  result: SandboxExecutionResult | null,
): readonly LedgerResourceFact[] {
  // Nothing is established by a dispatch that did not complete, and nothing at all is established
  // here by an operation that changes the world: what a write did is the probe's question.
  if (result === null || result.status !== "completed" || plan.effectClass !== "read") {
    return Object.freeze([]);
  }
  const resourceKind = RESOURCE_KIND_FOR.get(plan.operationId);
  if (resourceKind === undefined) return Object.freeze([]);

  const facts: LedgerResourceFact[] = [];
  for (const [locator, fingerprint] of readFingerprints(result)) {
    if (facts.length >= LEDGER_LIMITS.maxFacts) break;
    facts.push(
      Object.freeze({ resourceKind, locator, fingerprint: ContentHash.parse(fingerprint) }),
    );
  }
  return Object.freeze(facts);
}

/**
 * Which observation each executable read produces.
 *
 * Deliberately narrow. An operation appears here only when a backend genuinely reports something
 * fingerprintable for it; the `git.*` reads report a command's output rather than a resource state,
 * so they establish no durable fact yet and are absent rather than approximated.
 */
const RESOURCE_KIND_FOR: ReadonlyMap<string, string> = new Map([
  ["code.inspect", PRECONDITION_RESOURCE_KINDS.workspaceFile],
  ["browser.inspect", PRECONDITION_RESOURCE_KINDS.browseTarget],
]);

/**
 * Which governed operations can establish a given resource kind.
 *
 * Exported so the anti-deadlock rule is checkable rather than merely intended: a requirement whose
 * only producer is the operation it gates is a circular prerequisite, and a requirement with no
 * producer at all is a dead end. A regression asserts neither exists.
 */
export function operationsProducing(resourceKind: string): readonly string[] {
  return Object.freeze(
    [...RESOURCE_KIND_FOR.entries()]
      .filter(([, produced]) => produced === resourceKind)
      .map(([operationId]) => operationId),
  );
}

/** The backend's own `metadata.fingerprints` map, accepted only where it is well formed. */
function readFingerprints(result: SandboxExecutionResult): readonly (readonly [string, string])[] {
  const reported = result.metadata["fingerprints"];
  if (typeof reported !== "object" || reported === null || Array.isArray(reported)) return [];
  const pairs: (readonly [string, string])[] = [];
  for (const [locator, fingerprint] of Object.entries(reported as Record<string, unknown>)) {
    // An unreadable file fingerprints as the empty string; that is an absence, not an observation.
    if (typeof fingerprint !== "string" || !ContentHash.is(fingerprint)) continue;
    if (locator.length === 0 || locator.length > LEDGER_LIMITS.maxLocatorLength) continue;
    pairs.push([locator, fingerprint]);
  }
  return pairs;
}
