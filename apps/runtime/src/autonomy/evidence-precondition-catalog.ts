import type { EvidencePreconditionPolicy, PreconditionRequirement } from "@v31m4/application";
import type { TaskPhase } from "@v31m4/domain";
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
export const PRECONDITION_RESOURCE_KINDS = Object.freeze({
  /** Where the symbol being edited is actually defined, as last read. */
  symbolDefinition: "symbol_definition",
  /** What depends on it, so a patch is not applied blind to its blast radius. */
  impactAnalysis: "impact_analysis",
  /** Which tests will speak to this change; selected before the change, not after. */
  testSelection: "test_selection",
  /** The target and expectation a browser path was given, from a governed read. */
  verificationTarget: "verification_target",
  /** A recorded, still-current failure. Repair without one is not repair. */
  failureReport: "failure_report",
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
    "evidence.patch_requires_current_target.v1": Object.freeze([
      observe(PRECONDITION_RESOURCE_KINDS.symbolDefinition),
      observe(PRECONDITION_RESOURCE_KINDS.impactAnalysis),
      observe(PRECONDITION_RESOURCE_KINDS.testSelection),
    ]),
    "evidence.browse_requires_current_target.v1": Object.freeze([
      observe(PRECONDITION_RESOURCE_KINDS.verificationTarget),
    ]),
    "evidence.command_run_escape_hatch.v1": Object.freeze([
      observe(PRECONDITION_RESOURCE_KINDS.failureReport),
    ]),
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

/** Every requirement any other operation carries; the escape hatch may not undercut any of them. */
function escapeHatchUnion(): readonly PreconditionRequirement[] {
  const union: PreconditionRequirement[] = [];
  for (const operationId of SEMANTIC_OPERATION_IDS) {
    if (operationId === ESCAPE_HATCH) continue;
    union.push(...baseFor(getSemanticOperation(operationId)));
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
  // The task class. Changing the world during repair without a current recorded failure is acting
  // on a belief about what is broken; the observation is cheap and the alternative is a guess.
  //
  // Scoped to the classes that *change* something. Running a build or a test is how a failure
  // report comes to exist in the first place, so requiring one before those would be the deadlock
  // this design exists to avoid. `command.run` is not exempted by this: it carries the same
  // requirement in its own base policy, in every task class.
  if (taskPhase === "repair" && CHANGES_THE_WORLD.has(definition.effectClass)) {
    requirements.push(observe(PRECONDITION_RESOURCE_KINDS.failureReport));
  }
  return Object.freeze({
    // Attributable: a denial names which operation, in which task class, at which risk.
    policyId: `${definition.evidencePreconditionPolicyId}#${taskPhase}#${definition.riskClass}`,
    requirements: canonicalise(requirements),
  });
}
