import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationError,
  type PolicyEnginePort,
  type SandboxHandle,
  SandboxIsolationPolicy,
  type WorkspaceHandle,
} from "@v31m4/application";
import {
  ContentHash,
  EvidenceRecord,
  ExecutionLedgerEntry,
  JobId,
  ProjectId,
  ResourceBudget,
  SafePath,
  sha256Hex,
  TaskId,
} from "@v31m4/domain";
import {
  ReferenceSandboxBackend,
  type SqliteRuntimeDatabase,
  WorkspaceExecutionInterlock,
} from "@v31m4/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SqliteExecutionLedgerRepository,
  SqliteTaskCapsuleRepository,
} from "../../src/autonomy/autonomy-state-infrastructure.js";
import { GovernedExecutionSurface } from "../../src/autonomy/effect-reconciler.js";
import {
  PRECONDITION_RESOURCE_KINDS,
  resolveEvidencePrecondition,
} from "../../src/autonomy/evidence-precondition-catalog.js";
import { createEvidencePreconditionGate } from "../../src/autonomy/evidence-precondition-gate.js";
import type { SemanticExecutionRequest } from "../../src/autonomy/semantic-execution-authorization.js";
import {
  getSemanticOperation,
  SEMANTIC_OPERATION_IDS,
} from "../../src/autonomy/semantic-operation-catalog.js";
import { TaskManager } from "../../src/autonomy/task-manager.js";
import { SqliteEvidenceRepository } from "../../src/job-execution-infrastructure.js";
import { context, runtimeDatabase } from "../fixtures.js";

/**
 * Evidence-conditioned effects, end to end over real SQLite state and the real governed surface.
 *
 * The hard property this suite exists to hold: missing or stale evidence blocks an effect **without
 * blocking the investigation path needed to satisfy it**. A gate that deadlocked the agent would be
 * worse than no gate, because the agent could never produce the facts it is being asked for.
 */
const taskId = TaskId.parse("task:gated");
const jobId = JobId.parse("job:1");
const projectId = ProjectId.parse("project:1");
const T0 = "2026-08-27T00:00:00.000Z";

const isolation = SandboxIsolationPolicy.create({ maxCpuMillisPerSecond: 500, maxPids: 64 });
const budget = ResourceBudget.create({
  maxWallClockMs: 30_000,
  maxModelInvocations: 4,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
});

const policy: PolicyEnginePort = {
  async evaluate() {
    return { decision: "allow", policyId: "policy:gated", reasons: [], requiredApprovalScopes: [] };
  },
};

class FixedWorkspaces {
  async create(): Promise<WorkspaceHandle> {
    throw new Error("unused");
  }
  async get(id: string): Promise<WorkspaceHandle | null> {
    return id === workspace.id ? workspace : null;
  }
  async snapshot(): Promise<never> {
    throw new Error("unused");
  }
  async seal(): Promise<WorkspaceHandle> {
    return workspace;
  }
  async discard(): Promise<void> {}
}

let database: SqliteRuntimeDatabase;
let root: string;
let workspace: WorkspaceHandle;
let ledger: SqliteExecutionLedgerRepository;
let capsules: SqliteTaskCapsuleRepository;
let evidence: SqliteEvidenceRepository;
let tasks: TaskManager;
let surface: GovernedExecutionSurface;
let sandbox: SandboxHandle;
let entryCounter = 0;

/** Records a governed read's finding exactly as the harness does: an ordinary observation. */
async function observe(resourceKind: string, locator: string, at = "v1"): Promise<void> {
  entryCounter += 1;
  await database.unitOfWork.execute(context, async (transaction) => {
    await ledger.append(
      ExecutionLedgerEntry.create({
        id: `ledger:${entryCounter}`,
        taskId: "task:gated",
        jobId: "job:1",
        recordedAt: T0,
        kind: "observation",
        detail: `${resourceKind} observed`,
        facts: [{ resourceKind, locator, fingerprint: sha256Hex(locator + at) }],
      }),
      context,
      transaction,
    );
  });
}

/** What the workspace currently shows, as a caller that has just re-read it would report it. */
async function observedNow(): Promise<Record<string, string>> {
  const page = await ledger.listForTask(taskId, { limit: 200 }, context);
  const current: Record<string, string> = {};
  for (const entry of page.items) {
    if (entry.kind !== "observation" && entry.kind !== "check_result") continue;
    for (const fact of entry.facts) current[fact.locator] = fact.fingerprint;
  }
  return current;
}

async function patchPrerequisites(): Promise<void> {
  await observe(PRECONDITION_RESOURCE_KINDS.symbolDefinition, "src/target.ts#value");
  await observe(PRECONDITION_RESOURCE_KINDS.impactAnalysis, "src/target.ts");
  await observe(PRECONDITION_RESOURCE_KINDS.testSelection, "tests/target.test.ts");
}

async function authorize(
  overrides: Partial<SemanticExecutionRequest> & { readonly operationId: string },
): Promise<unknown> {
  return surface.authorize(
    {
      role: "executor" as const,
      taskId,
      jobId,
      workspace,
      sandbox,
      parameters: {},
      currentFingerprints: await observedNow(),
      ...overrides,
    } as SemanticExecutionRequest,
    context,
  );
}

const CURRENT_TARGET = ContentHash.parse(sha256Hex("export const value = 1;\n"));

const patchParameters = () => ({
  expectedFingerprint: CURRENT_TARGET,
  targetPath: "target.ts",
  pathScope: ["target.ts"],
  patch: "export const value = 2;\n",
});

/** A patch whose target is provably current, so only the evidence gate can refuse it. */
const patchRequest = () =>
  ({
    operationId: "code.patch",
    parameters: patchParameters(),
    observedTargetFingerprint: CURRENT_TARGET,
  }) as const;

async function denial(
  overrides: Partial<SemanticExecutionRequest> & { readonly operationId: string },
): Promise<ApplicationError> {
  try {
    await authorize(overrides);
  } catch (error) {
    if ((error as ApplicationError).code !== "POLICY_REJECTED") {
      throw new Error(
        `refused for the wrong reason: ${(error as ApplicationError).code} ${(error as Error).message} ${JSON.stringify((error as ApplicationError).details)}`,
      );
    }
    return error as ApplicationError;
  }
  throw new Error(`${overrides.operationId} was authorized when it should have been refused`);
}

/** Moves the task into `repair` the only way it can be reached: a governed, evidence-backed transition. */
async function enterRepairPhase(): Promise<void> {
  const record = EvidenceRecord.create({
    id: "evidence:failure",
    projectId: "project:1",
    jobId: "job:1",
    kind: "static_analysis",
    subjectType: "acceptance_criterion",
    subjectId: "requirement:one",
    status: "passed",
    summary: "requirement:one is not yet satisfied by the current implementation",
    artifactIds: ["artifact-failure"],
    verifierId: "verifier:deterministic",
    verifierVersion: "1.0.0",
    createdAt: T0,
  });
  await database.unitOfWork.execute(context, async (transaction) => {
    await evidence.append(record, context, transaction);
  });
  const current = await tasks.loadCurrent(taskId, context);
  if (current === null) throw new Error("missing capsule");
  await tasks.proposeTransition(
    {
      taskId: "task:gated",
      expectedHeadRevision: current.head.revision,
      expectedCapsuleRevision: current.capsule.capsuleRevision,
      from: "execute",
      to: "repair",
      evidenceIds: ["evidence:failure"],
      reason: "the verification path is still failing",
    },
    { verifiedEvidenceIds: ["evidence:failure"], attempts: 2, updatedAt: T0 },
    context,
  );
}

async function wire(phase: "execute" | "repair" = "execute"): Promise<void> {
  ledger = new SqliteExecutionLedgerRepository(database);
  capsules = new SqliteTaskCapsuleRepository(database);
  evidence = new SqliteEvidenceRepository(database);
  tasks = new TaskManager({ unitOfWork: database.unitOfWork, capsules, evidence });
  surface = GovernedExecutionSurface.create({
    policy,
    preconditions: createEvidencePreconditionGate({ capsules, ledger, evidence }),
    backend: new ReferenceSandboxBackend(),
    workspaces: new WorkspaceExecutionInterlock(new FixedWorkspaces()),
    allowedOperations: SEMANTIC_OPERATION_IDS,
    resolveWorkspaceRoot: async () => root,
    generateSandboxId: () => "sandbox:1",
    now: () => T0,
  });
  sandbox = await surface.sandboxes.prepare(taskId, jobId, workspace, budget, isolation, context);
  await tasks.createTask(
    {
      taskId: "task:gated",
      jobId: "job:1",
      projectId: "project:1",
      phase,
      attempts: 1,
      maxAttempts: 3,
      objective: "Repair the failing verification path.",
      acceptanceCriterionIds: ["requirement:one"],
      dagNodes: [{ id: "node:root", title: "Execute", dependsOn: [] }],
      workspaceId: "workspace-1",
      stopCondition: "stop after three attempts",
      updatedAt: T0,
    },
    context,
  );
}

beforeEach(async () => {
  entryCounter = 0;
  root = mkdtempSync(join(tmpdir(), "v31m4-gated-"));
  writeFileSync(join(root, "target.ts"), "export const value = 1;\n", "utf8");
  workspace = Object.freeze({
    id: "workspace-1",
    projectId,
    purpose: "tool_execution" as const,
    rootPath: SafePath.parse("workspace-1"),
    status: "active" as const,
    createdAt: T0,
  });
  database = runtimeDatabase();
  await wire();
});

afterEach(() => {
  database.close();
});

// ===========================================================================
// The gate itself
// ===========================================================================
describe("a consequential effect is refused until its facts exist", () => {
  it("refuses a patch when no definition, impact, or test prerequisite is recorded", async () => {
    const error = await denial(patchRequest());
    expect(error.code).toBe("POLICY_REJECTED");
    expect(String(error.details["missing"])).toMatch(/symbol_definition/u);
    expect(String(error.details["missing"])).toMatch(/impact_analysis/u);
    expect(String(error.details["missing"])).toMatch(/test_selection/u);
  });

  it("names only what is still missing once some prerequisites are recorded", async () => {
    await observe(PRECONDITION_RESOURCE_KINDS.symbolDefinition, "src/target.ts#value");
    const error = await denial(patchRequest());
    expect(String(error.details["missing"])).not.toMatch(/symbol_definition/u);
    expect(String(error.details["missing"])).toMatch(/impact_analysis/u);
  });

  it("authorizes the same patch once every prerequisite is current", async () => {
    await patchPrerequisites();
    const capability = await authorize({
      ...patchRequest(),
    });
    expect(capability).toBeDefined();
  });

  it("is non-retryable: repeating the identical request cannot change the answer", async () => {
    const first = await denial(patchRequest());
    const second = await denial(patchRequest());
    expect(first.retryable).toBe(false);
    expect(second.details["missing"]).toEqual(first.details["missing"]);
  });
});

describe("a stale fact is not a fact", () => {
  it("refuses the patch once an observed resource has moved on", async () => {
    await patchPrerequisites();
    const stale = await observedNow();
    // The impact analysis was computed against a file that has since changed underneath it.
    stale["src/target.ts"] = sha256Hex("something else entirely");
    const error = await denial({
      ...patchRequest(),
      currentFingerprints: stale,
    });
    expect(String(error.details["missing"])).toMatch(/impact_analysis/u);
    expect(String(error.details["missing"])).toMatch(/stale/iu);
  });

  it("refuses the patch when nothing is currently observed at all", async () => {
    await patchPrerequisites();
    const error = await denial({
      ...patchRequest(),
      currentFingerprints: {},
    });
    expect(error.code).toBe("POLICY_REJECTED");
  });

  it("refuses a prerequisite a later entry invalidated", async () => {
    await patchPrerequisites();
    entryCounter += 1;
    await database.unitOfWork.execute(context, async (transaction) => {
      await ledger.append(
        ExecutionLedgerEntry.create({
          id: `ledger:${entryCounter}`,
          taskId: "task:gated",
          jobId: "job:1",
          recordedAt: T0,
          kind: "invalidation",
          detail: "the impact analysis was superseded out of band",
          reason: "the impact analysis was superseded out of band",
          invalidatesEntryIds: ["ledger:2"],
        }),
        context,
        transaction,
      );
    });
    const error = await denial(patchRequest());
    expect(String(error.details["missing"])).toMatch(/impact_analysis/u);
  });
});

// ===========================================================================
// The investigation path
// ===========================================================================
describe("the path to satisfying the gate is never itself gated", () => {
  it("still authorizes every executable read while the patch is refused", async () => {
    await denial(patchRequest());
    for (const operationId of EXECUTABLE_READS) {
      await expect(
        authorize({ operationId, parameters: parametersFor(operationId) }),
      ).resolves.toBeDefined();
    }
  });

  it("gates none of the operations that produce evidence", async () => {
    // These have no trusted execution binding yet, so they cannot be authorized end to end. What
    // matters here is that the gate is not what stands in their way, and will not be when the
    // binding arrives: their resolved precondition is empty in every task class.
    for (const operationId of ["build.check", "test.targeted", "test.regression"] as const) {
      for (const phase of ["execute", "repair", "verify"] as const) {
        expect(
          resolveEvidencePrecondition(getSemanticOperation(operationId), phase).requirements,
        ).toHaveLength(0);
      }
    }
  });

  it("lets an agent go from refused to authorized using only ungated operations", async () => {
    await denial(patchRequest());
    // Everything the agent needs to learn is reachable, and recording what it learned is enough.
    for (const operationId of EXECUTABLE_READS) {
      await expect(
        authorize({ operationId, parameters: parametersFor(operationId) }),
      ).resolves.toBeDefined();
    }
    await patchPrerequisites();
    await expect(authorize(patchRequest())).resolves.toBeDefined();
  });
});

// ===========================================================================
// No path around it
// ===========================================================================
describe("no path reaches an effect with a weaker gate", () => {
  it("refuses the raw escape hatch wherever it refuses the semantic operation", async () => {
    const error = await denial({
      operationId: "command.run",
      parameters: { executable: "/bin/true", arguments: [] },
    });
    expect(String(error.details["missing"])).toMatch(/symbol_definition/u);
  });

  it("still refuses the escape hatch after the semantic operation's gate is satisfied", async () => {
    await patchPrerequisites();
    await expect(authorize(patchRequest())).resolves.toBeDefined();
    // command.run inherits every other gate and adds its own, so satisfying code.patch is not enough.
    const error = await denial({
      operationId: "command.run",
      parameters: { executable: "/bin/true", arguments: [] },
    });
    expect(String(error.details["missing"])).toMatch(/failure_report|verification_target/u);
  });

  it("authorizes the escape hatch only once every inherited requirement is met", async () => {
    await patchPrerequisites();
    await observe(PRECONDITION_RESOURCE_KINDS.verificationTarget, "http://localhost:1/health");
    await observe(PRECONDITION_RESOURCE_KINDS.failureReport, "reports/failure.json");
    await expect(
      authorize({
        operationId: "command.run",
        parameters: { executable: "/bin/true", arguments: [] },
      }),
    ).resolves.toBeDefined();
  });

  it("gates the browser paths, which cannot execute at all until they are bound", async () => {
    for (const operationId of ["browser.inspect", "browser.verify"] as const) {
      // No trusted execution binding exists yet, so the boundary refuses before anything else.
      await expect(
        authorize({
          operationId,
          parameters: { target: "http://localhost:1/", expectation: "ok" },
        }),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
      // And the gate is already in place for the day that binding arrives, so it cannot land
      // ungated beside the operations it would otherwise be a cheaper route to.
      expect(
        resolveEvidencePrecondition(getSemanticOperation(operationId), "execute").requirements,
      ).toHaveLength(1);
    }
  });
});

// ===========================================================================
// Task class and fail-closed behaviour
// ===========================================================================
describe("the task class is part of the predicate", () => {
  it("additionally requires a current failure before an effect during repair", async () => {
    await enterRepairPhase();
    await patchPrerequisites();
    const error = await denial(patchRequest());
    expect(String(error.details["missing"])).toMatch(/failure_report/u);
    await observe(PRECONDITION_RESOURCE_KINDS.failureReport, "reports/failure.json");
    await expect(authorize(patchRequest())).resolves.toBeDefined();
  });

  it("refuses an effect for a task that has no capsule to condition it against", async () => {
    const error = await denial({
      ...patchRequest(),
      taskId: TaskId.parse("task:absent"),
    });
    expect(error.code).toBe("POLICY_REJECTED");
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/no current task capsule/iu);
  });

  it("never writes anything of its own while deciding", async () => {
    const before = (await ledger.listForTask(taskId, { limit: 200 }, context)).total;
    await denial(patchRequest());
    expect((await ledger.listForTask(taskId, { limit: 200 }, context)).total).toBe(before);
  });
});

/** The read operations that have a trusted execution binding today. */
const EXECUTABLE_READS = Object.freeze([
  "git.status",
  "git.diff",
  "git.history",
  "code.inspect",
] as const);

/** The minimum valid parameters each read operation's own validation demands. */
function parametersFor(
  operationId: (typeof EXECUTABLE_READS)[number],
): Record<string, readonly string[]> {
  return operationId === "code.inspect" || operationId === "git.diff"
    ? { pathScope: ["target.ts"] }
    : {};
}
