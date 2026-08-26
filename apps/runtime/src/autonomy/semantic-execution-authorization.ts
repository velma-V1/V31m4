import { randomUUID } from "node:crypto";
import {
  ApplicationError,
  type ApplicationJsonObject,
  type AuthorizedSemanticExecutionPlan,
  createSemanticExecutionAuthority,
  type PolicyDecision,
  type SandboxCommand,
  type SandboxHandle,
  type SemanticExecutionCapabilityVerifier,
  type WorkspaceCurrencyPrecondition,
  type WorkspaceHandle,
} from "@v31m4/application";
import { type ContentHash, type JobId, SafePath, type TaskId } from "@v31m4/domain";
import {
  assertCodePatchTargetIsCurrent,
  getSemanticOperation,
  parseCodePatchScope,
  type SemanticOperationDefinition,
  type SemanticOperationRole,
} from "./semantic-operation-catalog.js";

/**
 * The single mandatory authorization boundary between a requested semantic operation and any
 * sandbox execution.
 *
 * Authorization and execution used to be separate steps: the sink took an operation name plus
 * free-form JSON, so a caller could name `git.status` while supplying `executable: "touch"`.
 * Now the only way to reach a backend is a single-use capability minted here.
 *
 * Two properties matter and neither is a type-level claim. First, the operation contract is read
 * from the canonical `SEMANTIC_OPERATION_CATALOG`, never accepted from the caller, so a request
 * cannot describe itself as a caller-commandable read. Second, minting authority lives in a
 * closure this module owns: `createSemanticAuthorizationBoundary` hands out `authorize` and a
 * verifier, and never the mint, so no other caller can produce a capability the paired sandbox
 * will accept.
 */

/**
 * Parameter names that could smuggle execution or container authority into an operation that
 * is not the raw escape hatch. Their mere presence is a denial, not a silent drop, so a
 * malformed or hostile request fails loudly instead of executing something else.
 */
const RESERVED_EXECUTION_KEYS = Object.freeze([
  "executable",
  "arguments",
  "argv",
  "command",
  "cmd",
  "entrypoint",
  "shell",
  "image",
  "user",
  "mount",
  "privileged",
  "network",
]);

const GIT = "git";
const MAX_PATH_SCOPE = 64;
const MAX_HISTORY_LIMIT = 500;
const DEFAULT_HISTORY_LIMIT = 20;

export interface SemanticExecutionRequest {
  readonly operationId: string;
  readonly role: SemanticOperationRole;
  readonly policyDecision: PolicyDecision;
  readonly taskId: TaskId;
  readonly jobId: JobId;
  readonly workspace: WorkspaceHandle;
  readonly sandbox: SandboxHandle | null;
  readonly parameters: ApplicationJsonObject;
  /**
   * The current fingerprint of a `code.patch` target, obtained from a prior governed read.
   * Without it the patch's currency cannot be proven, so the request is denied.
   */
  readonly observedTargetFingerprint?: ContentHash;
}

interface DerivedExecution {
  readonly command: SandboxCommand | null;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly currencyPrecondition: WorkspaceCurrencyPrecondition | null;
}

const ESCAPE_HATCH = "command.run";

/**
 * The paired halves of one authorization boundary. A composition root creates the boundary,
 * keeps `authorize` for the callers that request work, and gives `capabilities` to the sandbox
 * that executes it. The mint itself is never exposed.
 */
export interface SemanticAuthorizationBoundary {
  authorize(request: SemanticExecutionRequest): AuthorizedSemanticExecutionPlan;
  readonly capabilities: SemanticExecutionCapabilityVerifier;
}

export interface SemanticAuthorizationBoundaryOptions {
  readonly generateExecutionPlanId?: () => string;
  readonly now?: () => string;
}

export function createSemanticAuthorizationBoundary(
  options: SemanticAuthorizationBoundaryOptions = {},
): SemanticAuthorizationBoundary {
  const authority = createSemanticExecutionAuthority({
    generateExecutionPlanId: options.generateExecutionPlanId ?? (() => `plan:${randomUUID()}`),
    now: options.now ?? (() => new Date().toISOString()),
  });
  return Object.freeze({
    authorize(request: SemanticExecutionRequest): AuthorizedSemanticExecutionPlan {
      const definition = getSemanticOperation(request.operationId);
      assertEscapeHatchIsExclusive(definition);
      assertNoSmuggledExecution(definition, request.parameters);
      assertRequiredParameters(definition, request.parameters);
      const derived = deriveTrustedExecution(definition, request);
      return authority.mint({
        // Read from the canonical catalog, never from the request.
        contract: {
          operationId: definition.operationId,
          effectClass: definition.effectClass,
          sandboxRequirement: definition.sandboxRequirement,
          allowedRoles: definition.allowedRoles,
          allowsCallerSuppliedCommand: definition.allowsCallerSuppliedCommand,
        },
        role: request.role,
        policyDecision: request.policyDecision,
        taskId: request.taskId,
        jobId: request.jobId,
        workspace: request.workspace,
        sandbox: request.sandbox,
        command: derived.command,
        parameters: request.parameters,
        fingerprints: derived.fingerprints,
        currencyPrecondition: derived.currencyPrecondition,
      });
    },
    capabilities: Object.freeze({
      verify: (plan: unknown) => authority.verify(plan),
      consume: (plan: AuthorizedSemanticExecutionPlan) => authority.consume(plan),
    }),
  });
}

/**
 * `command.run` is the single declared escape hatch. If any other catalog entry ever claims it
 * may carry a caller-supplied command, that is a registry defect and execution stops here
 * rather than honouring it.
 */
function assertEscapeHatchIsExclusive(definition: SemanticOperationDefinition): void {
  if (definition.allowsCallerSuppliedCommand && definition.operationId !== ESCAPE_HATCH) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "Only command.run may carry a caller-supplied command.",
      { details: { operationId: definition.operationId } },
    );
  }
}

function assertNoSmuggledExecution(
  definition: SemanticOperationDefinition,
  parameters: ApplicationJsonObject,
): void {
  if (definition.allowsCallerSuppliedCommand) return;
  for (const key of RESERVED_EXECUTION_KEYS) {
    if (parameters[key] !== undefined) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "This semantic operation runs a trusted runtime-owned command and rejects caller-supplied execution parameters.",
        { details: { operationId: definition.operationId, rejectedParameter: key } },
      );
    }
  }
}

function assertRequiredParameters(
  definition: SemanticOperationDefinition,
  parameters: ApplicationJsonObject,
): void {
  for (const key of definition.requiredParameters) {
    if (parameters[key] === undefined) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "The semantic operation is missing a required parameter.",
        { details: { operationId: definition.operationId, missingParameter: key } },
      );
    }
  }
}

function deriveTrustedExecution(
  definition: SemanticOperationDefinition,
  request: SemanticExecutionRequest,
): DerivedExecution {
  const parameters = request.parameters;
  switch (definition.operationId) {
    case "command.run":
      return plain(readEscapeHatchCommand(parameters));
    case "git.status":
      return plain(gitCommand(["status", "--porcelain=v1"]));
    case "git.diff":
      return plain(gitCommand(["diff", "--no-color", "--", ...readPathScope(parameters)]));
    case "git.history":
      return plain(
        gitCommand(["log", "--no-color", `--max-count=${readHistoryLimit(parameters)}`]),
      );
    // Backend-native reads: the backend answers these from the assigned workspace without
    // spawning a process, so there is no command for a caller to influence at all.
    case "code.inspect":
      return plain(null);
    case "code.patch":
      return derivePatchExecution(request);
    default:
      // Fail closed. An operation with no trusted execution binding yet must never fall back
      // to running whatever the caller asked for.
      throw new ApplicationError(
        "UNSUPPORTED_OPERATION",
        "This semantic operation has no trusted execution binding yet and cannot be executed.",
        { details: { operationId: definition.operationId } },
      );
  }
}

function derivePatchExecution(request: SemanticExecutionRequest): DerivedExecution {
  const scope = parseCodePatchScope(request.parameters);
  if (request.observedTargetFingerprint === undefined) {
    throw new ApplicationError(
      "PERMISSION_DENIED",
      "code.patch requires the current observed target fingerprint; its currency cannot otherwise be proven.",
      { details: { expectedFingerprint: scope.expectedFingerprint } },
    );
  }
  assertCodePatchTargetIsCurrent(scope, request.observedTargetFingerprint);
  return {
    command: null,
    fingerprints: Object.freeze({
      expectedTarget: scope.expectedFingerprint,
      observedTarget: request.observedTargetFingerprint,
    }),
    // Re-verified at the sink: the workspace can still change between here and dispatch.
    currencyPrecondition: Object.freeze({
      path: scope.targetPath,
      expectedFingerprint: scope.expectedFingerprint,
      allowedPathScope: Object.freeze([...scope.pathScope]),
    }),
  };
}

function plain(command: SandboxCommand | null): DerivedExecution {
  return { command, fingerprints: {}, currencyPrecondition: null };
}

function gitCommand(args: readonly string[]): SandboxCommand {
  return Object.freeze({ executable: GIT, arguments: Object.freeze([...args]) });
}

function readEscapeHatchCommand(parameters: ApplicationJsonObject): SandboxCommand {
  const executable = parameters["executable"];
  const args = parameters["arguments"];
  if (typeof executable !== "string" || executable.length === 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "command.run requires an explicit non-empty executable.",
      {},
    );
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "command.run arguments must be an array of strings; no shell string is ever constructed.",
      {},
    );
  }
  return Object.freeze({
    executable,
    arguments: Object.freeze([...(args as readonly string[])]),
  });
}

function readPathScope(parameters: ApplicationJsonObject): readonly string[] {
  const scope = parameters["pathScope"];
  if (scope === undefined) return [];
  if (!Array.isArray(scope) || scope.length > MAX_PATH_SCOPE) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `A path scope must be an array of at most ${MAX_PATH_SCOPE} project-relative paths.`,
      {},
    );
  }
  return scope.map((entry) => {
    if (typeof entry !== "string") {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "Each path scope entry must be a project-relative path.",
        {},
      );
    }
    try {
      return SafePath.parse(entry);
    } catch (error) {
      throw new ApplicationError(
        "PERMISSION_DENIED",
        "A path scope entry escapes the assigned workspace.",
        { cause: error, details: { path: entry } },
      );
    }
  });
}

function readHistoryLimit(parameters: ApplicationJsonObject): number {
  const limit = parameters["limit"];
  if (limit === undefined) return DEFAULT_HISTORY_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > MAX_HISTORY_LIMIT
  ) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      `A history limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}.`,
      { details: { limit: String(limit) } },
    );
  }
  return limit as number;
}
