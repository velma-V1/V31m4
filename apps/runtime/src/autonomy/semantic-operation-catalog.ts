import { ApplicationError } from "@v31m4/application";
import { ContentHash, SafePath } from "@v31m4/domain";

/**
 * V31M4-AUTONOMY-001 / 1.1.0 — the model-facing semantic Agent-Computer Interface.
 *
 * V31M4 owns this registry. The vocabulary is deliberately small and high level: the model
 * asks for a semantic operation, and trusted runtime code decides whether, where, and how it
 * executes. There is no shell plumbing here, and there is deliberately no `git.worktree`:
 * `WorkspaceManagerPort` is the sole workspace/worktree authority and the model never
 * receives host `.git` authority.
 *
 * An operation ID is not necessarily one `ToolProfile`. Role permissions are operation-level,
 * not only tool-level.
 */
export const SEMANTIC_OPERATION_IDS = Object.freeze([
  "repo.map_task",
  "repo.search",
  "repo.symbol",
  "repo.references",
  "repo.impact",
  "repo.history",
  "code.inspect",
  "code.patch",
  "build.check",
  "test.targeted",
  "test.regression",
  "debug.reproduce",
  "failure.explain",
  "git.status",
  "git.diff",
  "git.history",
  "command.run",
  "browser.inspect",
  "browser.verify",
] as const);

export type SemanticOperationId = (typeof SEMANTIC_OPERATION_IDS)[number];

export type SemanticEffectClass =
  | "read"
  | "workspace_write"
  | "process_execute"
  | "network_read"
  | "network_effect";

export type SemanticRiskClass = "low" | "moderate" | "high" | "critical";

/** Sequential harness roles; see the Manager/Executor/Auditor phase for their orchestration. */
export type SemanticOperationRole = "manager" | "executor" | "auditor";

export type SemanticSandboxRequirement = "none" | "required";

export interface SemanticResourcePolicy {
  readonly maxWallClockMs: number;
  readonly maxOutputBytes: number;
  readonly maxConcurrent: number;
}

export interface SemanticOperationDefinition {
  readonly operationId: SemanticOperationId;
  readonly inputSchemaVersion: string;
  readonly resultSchemaVersion: string;
  readonly effectClass: SemanticEffectClass;
  readonly riskClass: SemanticRiskClass;
  readonly sandboxRequirement: SemanticSandboxRequirement;
  readonly allowedRoles: readonly SemanticOperationRole[];
  /**
   * Reference to the deterministic evidence-precondition policy that gates this operation.
   * The precondition engine itself, and the `EvidenceRecord`/Ledger predicates it evaluates,
   * belong to the evidence-conditioned-effects phase. This is a reference only — it does not
   * introduce a second evidence taxonomy.
   */
  readonly evidencePreconditionPolicyId: string;
  readonly resourcePolicy: SemanticResourcePolicy;
  readonly requiredParameters: readonly string[];
  /**
   * True only for `command.run`, the explicit raw escape hatch. Every other operation maps to
   * a trusted runtime-owned command, so a caller cannot disguise an arbitrary executable as a
   * harmless read.
   */
  readonly allowsCallerSuppliedCommand: boolean;
}

const SCHEMA_VERSION = "1.0.0";

const READ_ROLES = Object.freeze<readonly SemanticOperationRole[]>([
  "manager",
  "executor",
  "auditor",
]);
/**
 * Anything that is not a pure read is Executor-only by default: the Manager cannot act and the
 * Auditor is read-only, so neither reaches a write, execute, or network-effect operation.
 */
const EFFECT_ROLES = Object.freeze<readonly SemanticOperationRole[]>(["executor"]);

/**
 * The one operation-level widening of the default.
 *
 * `browser.verify` checks a stated expectation against a target: that is what an audit *is*, and
 * the role contract bars a read-only role from write, execute, and network-**effect** operations —
 * `browser.verify` is a `network_read`. It was left Executor-only when the roles did not yet exist;
 * with the roles implemented and regression-covered, the conservative default has been reviewed
 * and narrowed to exactly this operation.
 *
 * `browser.inspect` is deliberately *not* widened. Open-ended exploration of a network target is
 * not verification, and the narrower change is the one the evidence supports.
 */
const VERIFY_ROLES = Object.freeze<readonly SemanticOperationRole[]>(["executor", "auditor"]);

const READ_RESOURCES: SemanticResourcePolicy = Object.freeze({
  maxWallClockMs: 30_000,
  maxOutputBytes: 1_048_576,
  maxConcurrent: 4,
});
const EXECUTE_RESOURCES: SemanticResourcePolicy = Object.freeze({
  maxWallClockMs: 900_000,
  maxOutputBytes: 4_194_304,
  maxConcurrent: 1,
});

function define(
  operationId: SemanticOperationId,
  effectClass: SemanticEffectClass,
  riskClass: SemanticRiskClass,
  evidencePreconditionPolicyId: string,
  requiredParameters: readonly string[] = [],
  allowsCallerSuppliedCommand = false,
  /** Operation-level override of the effect-class default; used once, for `browser.verify`. */
  allowedRoles?: readonly SemanticOperationRole[],
): SemanticOperationDefinition {
  const isRead = effectClass === "read";
  return Object.freeze({
    operationId,
    inputSchemaVersion: SCHEMA_VERSION,
    resultSchemaVersion: SCHEMA_VERSION,
    effectClass,
    riskClass,
    sandboxRequirement: isRead ? "none" : "required",
    allowedRoles: allowedRoles ?? (isRead ? READ_ROLES : EFFECT_ROLES),
    evidencePreconditionPolicyId,
    resourcePolicy: isRead ? READ_RESOURCES : EXECUTE_RESOURCES,
    requiredParameters: Object.freeze([...requiredParameters]),
    allowsCallerSuppliedCommand,
  });
}

const DEFINITIONS: readonly SemanticOperationDefinition[] = Object.freeze([
  define("repo.map_task", "read", "low", "evidence.none.v1", ["objective"]),
  define("repo.search", "read", "low", "evidence.none.v1", ["query"]),
  define("repo.symbol", "read", "low", "evidence.none.v1", ["symbol"]),
  define("repo.references", "read", "low", "evidence.none.v1", ["symbol"]),
  define("repo.impact", "read", "low", "evidence.none.v1", ["locators"]),
  define("repo.history", "read", "low", "evidence.none.v1", ["locators"]),
  define("code.inspect", "read", "low", "evidence.none.v1", ["pathScope"]),
  define("code.patch", "workspace_write", "high", "evidence.patch_requires_current_target.v1", [
    "expectedFingerprint",
    "targetPath",
    "pathScope",
    "patch",
  ]),
  define("build.check", "process_execute", "moderate", "evidence.none.v1"),
  define("test.targeted", "process_execute", "moderate", "evidence.none.v1", ["selection"]),
  define("test.regression", "process_execute", "moderate", "evidence.none.v1"),
  define("debug.reproduce", "process_execute", "moderate", "evidence.none.v1", ["reproduction"]),
  define("failure.explain", "read", "low", "evidence.none.v1", ["failureRef"]),
  define("git.status", "read", "low", "evidence.none.v1"),
  define("git.diff", "read", "low", "evidence.none.v1"),
  define("git.history", "read", "low", "evidence.none.v1"),
  // Raw command execution is the explicit escape hatch. It carries the highest risk class and
  // may never be used to sidestep a stronger semantic operation's evidence gate.
  define(
    "command.run",
    "process_execute",
    "critical",
    "evidence.command_run_escape_hatch.v1",
    ["executable", "arguments"],
    true,
  ),
  // A browser path is only as trustworthy as the target it was given. Both require a current
  // recorded target so the model cannot browse somewhere it merely remembers.
  define("browser.inspect", "network_read", "high", "evidence.browse_requires_current_target.v1", [
    "target",
  ]),
  define(
    "browser.verify",
    "network_read",
    "high",
    "evidence.browse_requires_current_target.v1",
    ["target", "expectation"],
    false,
    VERIFY_ROLES,
  ),
]);

export const SEMANTIC_OPERATION_CATALOG: Readonly<
  Record<SemanticOperationId, SemanticOperationDefinition>
> = Object.freeze(
  Object.fromEntries(DEFINITIONS.map((definition) => [definition.operationId, definition])),
) as Readonly<Record<SemanticOperationId, SemanticOperationDefinition>>;

export function isSemanticOperationId(value: string): value is SemanticOperationId {
  return Object.hasOwn(SEMANTIC_OPERATION_CATALOG, value);
}

/** Resolves a definition, rejecting any operation outside the approved closed vocabulary. */
export function getSemanticOperation(operationId: string): SemanticOperationDefinition {
  if (!isSemanticOperationId(operationId)) {
    throw new ApplicationError(
      "UNSUPPORTED_OPERATION",
      "The requested semantic operation is not in the approved V31M4 operation catalog.",
      { details: { operationId } },
    );
  }
  return SEMANTIC_OPERATION_CATALOG[operationId];
}

export function assertSemanticOperationAllowedForRole(
  operationId: string,
  role: SemanticOperationRole,
): SemanticOperationDefinition {
  const definition = getSemanticOperation(operationId);
  if (!definition.allowedRoles.includes(role)) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "The requested semantic operation is not permitted for this role.",
      { details: { operationId, role, allowedRoles: [...definition.allowedRoles] } },
    );
  }
  return definition;
}

export interface CodePatchScope {
  readonly expectedFingerprint: ContentHash;
  /** The exact workspace file the fingerprint describes; must be inside `pathScope`. */
  readonly targetPath: SafePath;
  readonly pathScope: readonly SafePath[];
}

const MAX_PATCH_PATHS = 64;

/**
 * `code.patch` must name the exact current file/symbol fingerprint it believes it is editing
 * and the closed set of paths it is allowed to touch. Without both, a patch computed against
 * a stale read could silently overwrite newer work.
 */
export function parseCodePatchScope(parameters: unknown): CodePatchScope {
  const record = asRecord(parameters);
  const expected = record["expectedFingerprint"];
  if (typeof expected !== "string" || !ContentHash.is(expected)) {
    throw invalid("code.patch requires the expected current target fingerprint.", {
      expectedFingerprint: String(expected),
    });
  }
  const rawScope = record["pathScope"];
  if (!Array.isArray(rawScope) || rawScope.length === 0 || rawScope.length > MAX_PATCH_PATHS) {
    throw invalid(`code.patch requires 1 to ${MAX_PATCH_PATHS} explicitly scoped paths.`, {
      pathScopeSize: Array.isArray(rawScope) ? rawScope.length : -1,
    });
  }
  const pathScope: SafePath[] = [];
  for (const entry of rawScope) {
    if (typeof entry !== "string") {
      throw invalid("Each code.patch path scope entry must be a project-relative path.");
    }
    try {
      pathScope.push(SafePath.parse(entry));
    } catch (error) {
      throw invalid("A code.patch path scope entry escapes the assigned workspace.", {
        path: entry,
        reason: error instanceof Error ? error.message : "invalid path",
      });
    }
  }
  const rawTarget = record["targetPath"];
  if (typeof rawTarget !== "string") {
    throw invalid("code.patch requires the target path the expected fingerprint describes.");
  }
  let targetPath: SafePath;
  try {
    targetPath = SafePath.parse(rawTarget);
  } catch (error) {
    throw invalid("The code.patch target path escapes the assigned workspace.", {
      path: rawTarget,
      reason: error instanceof Error ? error.message : "invalid path",
    });
  }
  if (!pathScope.includes(targetPath)) {
    throw invalid("The code.patch target path must be inside the declared path scope.", {
      targetPath,
    });
  }
  if (typeof record["patch"] !== "string" || record["patch"].length === 0) {
    throw invalid("code.patch requires a non-empty patch body.");
  }
  return Object.freeze({
    expectedFingerprint: ContentHash.parse(expected),
    targetPath,
    pathScope: Object.freeze(pathScope),
  });
}

/** A patch whose target moved since it was computed is rejected, never applied. */
export function assertCodePatchTargetIsCurrent(
  scope: CodePatchScope,
  observedFingerprint: ContentHash,
): void {
  if (!ContentHash.equals(scope.expectedFingerprint, observedFingerprint)) {
    throw new ApplicationError(
      "CONFLICT",
      "The code.patch target changed since it was inspected; the stale edit is rejected.",
      {
        details: {
          expectedFingerprint: scope.expectedFingerprint,
          observedFingerprint,
          pathScope: [...scope.pathScope],
        },
      },
    );
  }
}

/**
 * The catalog is metadata and validation only. It deliberately exposes no execution gate of
 * its own: `authorizeSemanticExecution` in `semantic-execution-authorization.ts` is the single
 * boundary that turns a request into an executable, sandbox-bound authorization.
 */

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("Semantic operation parameters must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function invalid(message: string, details: Record<string, string | number> = {}): ApplicationError {
  return new ApplicationError("INVALID_APPLICATION_INPUT", message, { details });
}
