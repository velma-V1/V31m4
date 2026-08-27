import type { EvidencePreconditionPolicy, PreconditionRequirement } from "@v31m4/application";
import type { EvidenceKind, TaskPhase } from "@v31m4/domain";
import {
  getSemanticOperation,
  SEMANTIC_OPERATION_IDS,
  type SemanticOperationDefinition,
} from "./semantic-operation-catalog.js";

/**
 * Which facts each semantic operation needs before it may act.
 *
 * The catalog already names an `evidencePreconditionPolicyId` per operation; this is the policy
 * those names refer to, kept beside the catalog so operation and gate cannot drift apart. The
 * predicate is over three things, exactly as the architecture requires: the operation, the task
 * class it is attempted in, and its risk. All three are read from authoritative state — the closed
 * catalog and the Task Capsule's own phase — and none of them from a caller.
 *
 * Two properties are the point of the whole file.
 *
 * The read path is never gated. Every requirement below is satisfied by *reading*, and no read
 * operation carries a requirement of its own, so an agent that is denied can always go and get
 * what it was told is missing. A gate that could deadlock an agent would be a gate that produces
 * no evidence at all.
 *
 * The escape hatch is never the cheap way round. `command.run` inherits the union of every other
 * operation's requirements. Anything that would be gated as a semantic operation is gated at least
 * as hard when spelled as a raw command, and a gated operation added later strengthens the escape
 * hatch automatically rather than opening a hole beside it.
 */
/**
 * The resource kinds a requirement may name.
 *
 * Every one of these is something the *current* governed path can honestly establish. That is the
 * whole constraint on this list: a requirement naming a fact no deterministic machinery can produce
 * is not a gate, it is a deadlock, and inventing a record to satisfy it would be worse than either.
 * When Task 7 brings symbol, impact, and test-selection machinery, its facts join this list and the
 * policies below tighten; until then the gate asks only for what can be answered.
 */
export const PRECONDITION_RESOURCE_KINDS = Object.freeze({
  /**
   * A workspace file's content fingerprint, as observed by a governed read.
   *
   * Produced by the runtime from what the backend actually read off disk — see
   * `governed-observation.ts` — never from anything a model said.
   */
  workspaceFile: "workspace_file",
  /** A network target a governed `browser.inspect` actually looked at. */
  browseTarget: "browse_target",
});

/**
 * The evidence a task must already hold before the riskiest paths open.
 *
 * Existing semantics throughout: an immutable `EvidenceRecord` of a recognised kind, about an
 * acceptance criterion this task owns, that passed. Scoping is the canonical `assessTaskEvidence`
 * assessment the transition policy and the Auditor already use — this introduces no second
 * taxonomy and no second scope rule.
 */
const VERIFIED_TASK_EVIDENCE: PreconditionRequirement = Object.freeze({
  kind: "evidence" as const,
  allowedEvidenceKinds: Object.freeze([
    "unit_test",
    "integration_test",
    "property_test",
    "hidden_test",
    "mutation_test",
    "static_analysis",
  ]) as readonly EvidenceKind[],
  subjectType: "acceptance_criterion",
  requirePassed: true as const,
});

function observe(resourceKind: string): PreconditionRequirement {
  return Object.freeze({
    kind: "ledger_observation" as const,
    resourceKind,
    requireCurrentFingerprint: true as const,
  });
}

/**
 * The base requirement set each catalog policy id names.
 *
 * These are ledger observations rather than evidence records on purpose: they are things that were
 * *observed about the workspace* and can go stale, which is precisely what currency is for. Evidence
 * records are immutable verdicts and belong to the acceptance contract, not to a pre-effect gate.
 */
const BASE_REQUIREMENTS: Readonly<Record<string, readonly PreconditionRequirement[]>> =
  Object.freeze({
    "evidence.none.v1": Object.freeze([]),
    // A patch must be preceded by a governed read of the workspace that is still current. This is
    // acquirable: `code.inspect` records exactly this fact, from bytes the backend read.
    "evidence.patch_requires_current_target.v1": Object.freeze([
      observe(PRECONDITION_RESOURCE_KINDS.workspaceFile),
    ]),
    // Verification may require inspection; inspection may never require verification.
    "evidence.verify_requires_inspected_target.v1": Object.freeze([
      observe(PRECONDITION_RESOURCE_KINDS.browseTarget),
    ]),
    // Raw execution is the critical escape hatch. Beyond the union it inherits, it asks the one
    // thing that distinguishes a task doing verified work from one flailing: something about this
    // task has actually been verified.
    "evidence.command_run_escape_hatch.v1": Object.freeze([VERIFIED_TASK_EVIDENCE]),
  });

const ESCAPE_HATCH = "command.run";

/** Effect classes that alter something outside V31M4, as opposed to observing or exercising it. */
const CHANGES_THE_WORLD: ReadonlySet<string> = new Set(["workspace_write", "network_effect"]);

/** Sorted by resource kind, then subject, so an identical policy is identical every time. */
function canonicalise(
  requirements: readonly PreconditionRequirement[],
): readonly PreconditionRequirement[] {
  const byKey = new Map<string, PreconditionRequirement>();
  for (const requirement of requirements) {
    byKey.set(keyOf(requirement), requirement);
  }
  return Object.freeze([...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, r]) => r));
}

function keyOf(requirement: PreconditionRequirement): string {
  return requirement.kind === "ledger_observation"
    ? `ledger_observation:${requirement.resourceKind}`
    : `evidence:${requirement.subjectType}:${[...requirement.allowedEvidenceKinds].sort().join(",")}`;
}

function baseFor(definition: SemanticOperationDefinition): readonly PreconditionRequirement[] {
  return BASE_REQUIREMENTS[definition.evidencePreconditionPolicyId] ?? [];
}

/**
 * Every requirement an *executable* operation carries; the escape hatch may not undercut any.
 *
 * Restricted to operations that have a trusted execution binding, because an operation nothing can
 * run cannot be bypassed — and inheriting a requirement no governed path can satisfy would make raw
 * execution unreachable for a reason that has nothing to do with risk. When an unbound operation
 * gains its binding, its requirements join this union on the same day, with no edit here.
 */
function escapeHatchUnion(): readonly PreconditionRequirement[] {
  const union: PreconditionRequirement[] = [];
  for (const operationId of SEMANTIC_OPERATION_IDS) {
    if (operationId === ESCAPE_HATCH) continue;
    const definition = getSemanticOperation(operationId);
    if (!definition.hasTrustedExecutionBinding) continue;
    union.push(...baseFor(definition));
  }
  return union;
}

export function resolveEvidencePrecondition(
  definition: SemanticOperationDefinition,
  taskPhase: TaskPhase,
): EvidencePreconditionPolicy {
  const requirements: PreconditionRequirement[] = [...baseFor(definition)];
  if (definition.operationId === ESCAPE_HATCH) {
    requirements.push(...escapeHatchUnion());
  }
  // The task class. A capsule may only enter `repair` by citing evidence — Task 2's transition
  // policy already requires it — so a repairing task provably holds verified evidence about what
  // is true. Requiring it again here is what stops a repair from proceeding against a capsule whose
  // evidence has since been superseded, and it is acquirable through the one governed path that
  // could have put the task in this phase at all.
  //
  // Scoped to the classes that *change* something: running a build or a test is how evidence comes
  // to exist, and gating those would be the deadlock this design exists to avoid.
  if (taskPhase === "repair" && CHANGES_THE_WORLD.has(definition.effectClass)) {
    requirements.push(VERIFIED_TASK_EVIDENCE);
  }
  return Object.freeze({
    // Attributable: a denial names which operation, in which task class, at which risk.
    policyId: `${definition.evidencePreconditionPolicyId}#${taskPhase}#${definition.riskClass}`,
    requirements: canonicalise(requirements),
  });
}
