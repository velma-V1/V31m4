import { ApplicationError } from "@v31m4/application";
import {
  type CanonicalValue,
  type ContentHash,
  canonicalFingerprint,
  type LedgerResourceFact,
  type ModelId,
  type TaskId,
} from "@v31m4/domain";
import {
  assertSemanticOperationAllowedForRole,
  getSemanticOperation,
  type SemanticOperationId,
  type SemanticOperationRole,
} from "./semantic-operation-catalog.js";

/**
 * The role invocation manifest: exactly what one role was allowed to do, and against exactly which
 * task state, context, model, skills, and harness it did it.
 *
 * It is minted here, never assembled by a caller, because two of its fields are the whole point.
 * `readOnly` is *derived* from the role rather than believed — a caller cannot declare a writable
 * Auditor or a read-only Executor — and `allowedOperations` is checked three ways before the
 * manifest exists: every entry must be in the closed catalog, must be permitted for the role, and,
 * for a read-only role, must carry no write, execute, or network-effect authority at all.
 *
 * The fingerprint makes the invocation citable. Task 5 persists it as ordinary Ledger resource
 * facts rather than inventing a new record type: see `roleInvocationFacts`.
 */
export interface RoleInvocationManifest {
  readonly role: SemanticOperationRole;
  readonly taskId: TaskId;
  readonly capsuleFingerprint: ContentHash;
  readonly contextFingerprint: ContentHash;
  readonly modelId: ModelId;
  readonly allowedOperations: readonly SemanticOperationId[];
  readonly skillVersions: readonly string[];
  readonly harnessVersion: string;
  readonly readOnly: boolean;
  /** The frozen acceptance contract this invocation is bound to. */
  readonly acceptanceContractFingerprint: ContentHash;
  readonly manifestFingerprint: ContentHash;
}

export interface RoleManifestInput {
  readonly role: SemanticOperationRole;
  readonly taskId: TaskId;
  readonly capsuleFingerprint: ContentHash;
  readonly contextFingerprint: ContentHash;
  readonly modelId: ModelId;
  readonly allowedOperations: readonly SemanticOperationId[];
  readonly skillVersions: readonly string[];
  readonly harnessVersion: string;
  readonly acceptanceContractFingerprint: ContentHash;
}

const MAX_OPERATIONS = 32;
const MAX_SKILL_VERSIONS = 64;

/** Only the Executor acts. The Manager selects and the Auditor judges; neither may change anything. */
const ACTING_ROLES: ReadonlySet<SemanticOperationRole> = new Set<SemanticOperationRole>([
  "executor",
]);

/** What a read-only role may still do: observe. Everything else is denied by effect class. */
const READ_ONLY_EFFECT_CLASSES: ReadonlySet<string> = new Set(["read", "network_read"]);

export function isReadOnlyRole(role: SemanticOperationRole): boolean {
  return !ACTING_ROLES.has(role);
}

/**
 * The permission check the harness runs *before* a role is dispatched, exposed separately so a
 * caller can fail closed without first constructing a manifest it may not be entitled to.
 */
export function assertRoleInvocationPermitted(
  role: SemanticOperationRole,
  allowedOperations: readonly SemanticOperationId[],
): readonly SemanticOperationId[] {
  const unique = [...new Set(allowedOperations)].sort() as SemanticOperationId[];
  if (unique.length === 0 || unique.length > MAX_OPERATIONS) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `A role manifest must offer between 1 and ${MAX_OPERATIONS} semantic operations.`,
      { details: { role, count: unique.length } },
    );
  }
  const readOnly = isReadOnlyRole(role);
  for (const operationId of unique) {
    // The closed catalog first, then this role's own permissions. Both refuse, never coerce.
    const definition = assertSemanticOperationAllowedForRole(operationId, role);
    if (readOnly && !READ_ONLY_EFFECT_CLASSES.has(definition.effectClass)) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "A read-only role may hold no write, execute, or network-effect operation.",
        { details: { role, operationId, effectClass: definition.effectClass } },
      );
    }
  }
  return Object.freeze(unique);
}

function boundedVersions(values: readonly string[]): readonly string[] {
  const unique = [...new Set(values)].sort();
  if (unique.length > MAX_SKILL_VERSIONS) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `A role manifest may cite at most ${MAX_SKILL_VERSIONS} skill versions.`,
      { details: { count: unique.length } },
    );
  }
  for (const value of unique) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "Every cited skill version must be bounded non-empty text.",
        {},
      );
    }
  }
  return Object.freeze(unique);
}

export function mintRoleInvocationManifest(input: RoleManifestInput): RoleInvocationManifest {
  if (typeof input.harnessVersion !== "string" || input.harnessVersion.trim().length === 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "A role manifest must name the harness version it ran under.",
      {},
    );
  }
  const state = {
    role: input.role,
    taskId: input.taskId,
    capsuleFingerprint: input.capsuleFingerprint,
    contextFingerprint: input.contextFingerprint,
    modelId: input.modelId,
    allowedOperations: assertRoleInvocationPermitted(input.role, input.allowedOperations),
    skillVersions: boundedVersions(input.skillVersions),
    harnessVersion: input.harnessVersion,
    // Derived, never supplied: this is the field a caller would most want to be wrong.
    readOnly: isReadOnlyRole(input.role),
    acceptanceContractFingerprint: input.acceptanceContractFingerprint,
  };
  return Object.freeze({
    ...state,
    manifestFingerprint: canonicalFingerprint({
      ...state,
      allowedOperations: [...state.allowedOperations],
      skillVersions: [...state.skillVersions],
    } as unknown as CanonicalValue),
  });
}

/** Proves a manifest is the one an invocation was dispatched under. */
export function assertRoleManifest(
  manifest: RoleInvocationManifest,
  expectedFingerprint: ContentHash,
): void {
  if (manifest.manifestFingerprint !== expectedFingerprint) {
    throw new ApplicationError(
      "INTEGRITY_FAILURE",
      "The role manifest does not match the invocation it claims to describe.",
      { details: { role: manifest.role, taskId: manifest.taskId } },
    );
  }
}

/**
 * The manifest as ordinary Execution Ledger resource facts.
 *
 * Deliberately not a new record type. Role, context, model, skill, and harness identity are things
 * that were observed about an invocation, and the Ledger already knows how to record observed
 * resources — so the invocation becomes citable evidence through the authority that already exists.
 */
export function roleInvocationFacts(
  manifest: RoleInvocationManifest,
): readonly LedgerResourceFact[] {
  return Object.freeze([
    Object.freeze({
      resourceKind: "role_manifest",
      locator: `${manifest.role}:${manifest.taskId}`,
      fingerprint: manifest.manifestFingerprint,
    }),
    Object.freeze({
      resourceKind: "agent_context",
      locator: `${manifest.role}:${manifest.taskId}:context`,
      fingerprint: manifest.contextFingerprint,
    }),
    Object.freeze({
      resourceKind: "task_capsule",
      locator: manifest.taskId,
      fingerprint: manifest.capsuleFingerprint,
    }),
    Object.freeze({
      resourceKind: "acceptance_contract",
      locator: `${manifest.taskId}:acceptance`,
      fingerprint: manifest.acceptanceContractFingerprint,
    }),
  ]);
}

/** A diagnostic used in refusal details; the catalog remains the authority. */
export function effectClassOf(operationId: SemanticOperationId): string {
  return getSemanticOperation(operationId).effectClass;
}
