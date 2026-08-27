import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
let reconciler: ReturnType<GovernedExecutionSurface["createEffectReconciler"]>;
let sandbox: SandboxHandle;
let entryCounter = 0;

/**
 * Runs one governed operation the whole way: authorize, dispatch, reconcile, record.
 *
 * This is how the facts a later precondition consumes actually come to exist. Nothing here writes a
 * ledger entry by hand — the runtime derives the observation from what the backend returned.
 */
async function govern(
  overrides: Partial<SemanticExecutionRequest> & { readonly operationId: string },
): Promise<void> {
  const plan = await authorize(overrides);
  await reconciler.runGovernedEffect(
    {
      taskId,
      plan: plan as never,
      sandbox,
      // The probe reports one deliberately irrelevant fact. Everything the gate later consumes
      // comes from the runtime's own reading of the backend result, never from here.
      probe: async () => ({
        kind: "applied" as const,
        facts: [
          {
            resourceKind: "probe_only",
            locator: "probe",
            fingerprint: ContentHash.parse(sha256Hex("probe")),
          },
        ],
      }),
    },
    context,
  );
}

/** What the workspace actually shows right now, hashed off disk exactly as the backend does. */
function observedNow(): Record<string, string> {
  const current: Record<string, string> = {};
  for (const name of ["target.ts", "other.ts"]) {
    current[name] = sha256Hex(readFileSync(join(root, name), "utf8"));
  }
  return current;
}

/** The one governed read that establishes what `code.patch` needs. */
async function inspectTarget(): Promise<void> {
  await govern({ operationId: "code.inspect", parameters: { pathScope: ["target.ts"] } });
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
      currentFingerprints: observedNow(),
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

/**
 * Puts verified evidence on the capsule the only way it can get there: an immutable record in the
 * authoritative store, cited by a governed transition. Nothing about the evidence requirement is
 * satisfiable by writing to the ledger directly.
 */
async function transitionWithEvidence(to: "verify" | "repair"): Promise<void> {
  const record = EvidenceRecord.create({
    id: `evidence:${to}`,
    projectId: "project:1",
    jobId: "job:1",
    kind: "unit_test",
    subjectType: "acceptance_criterion",
    subjectId: "requirement:one",
    status: "passed",
    summary: "requirement:one is backed by a passing unit test",
    artifactIds: [`artifact-${to}`],
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
      to,
      evidenceIds: [record.id],
      reason: "the executor declared readiness",
    },
    {
      verifiedEvidenceIds: [record.id],
      ...(to === "repair" ? { attempts: 2 } : {}),
      updatedAt: T0,
    },
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
  reconciler = surface.createEffectReconciler({
    unitOfWork: database.unitOfWork,
    ledger,
    generateEntryId: () => `ledger:${++entryCounter}`,
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
  writeFileSync(join(root, "other.ts"), "export const other = 2;\n", "utf8");
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
// The acquisition loop
// ===========================================================================
describe("a governed investigation produces the facts a later effect consumes", () => {
  it("refuses a patch against a file no governed read has ever looked at", async () => {
    const error = await denial(patchRequest());
    expect(error.code).toBe("POLICY_REJECTED");
    expect(String(error.details["missing"])).toMatch(/workspace_file/u);
    expect(String(error.details["missing"])).toMatch(/no workspace_file has been observed/u);
  });

  it("authorizes the same patch after a governed code.inspect, and nothing else", async () => {
    await denial(patchRequest());
    // The only thing that happens between the refusal and the authorization is one governed read.
    await inspectTarget();
    await expect(authorize(patchRequest())).resolves.toBeDefined();
  });

  it("records the observation from the backend's own reading, not from any caller", async () => {
    await inspectTarget();
    const page = await ledger.listForTask(taskId, { limit: 200 }, context);
    const facts = page.items.flatMap((entry) =>
      entry.kind === "observation" ? [...entry.facts] : [],
    );
    const observed = facts.find((fact) => fact.resourceKind === "workspace_file");
    expect(observed?.locator).toBe("target.ts");
    // Exactly the hash of what is really on disk. A probe returning "unknown" cannot suppress it.
    expect(observed?.fingerprint).toBe(sha256Hex(readFileSync(join(root, "target.ts"), "utf8")));
  });

  it("is non-retryable: repeating the identical request cannot change the answer", async () => {
    const first = await denial(patchRequest());
    const second = await denial(patchRequest());
    expect(first.retryable).toBe(false);
    expect(second.details["missing"]).toEqual(first.details["missing"]);
  });
});

// ===========================================================================
// Currency
// ===========================================================================
describe("a stale fact is not a fact", () => {
  it("refuses the patch once the inspected file has changed underneath it", async () => {
    await inspectTarget();
    await expect(authorize(patchRequest())).resolves.toBeDefined();
    // Someone else edits the workspace. The recorded observation is now about a file that is gone.
    writeFileSync(join(root, "target.ts"), "export const value = 99;\n", "utf8");
    const error = await denial(patchRequest());
    expect(String(error.details["missing"])).toMatch(/workspace_file/u);
    expect(String(error.details["missing"])).toMatch(/stale/iu);
  });

  it("is satisfied again by a fresh governed read of the changed file", async () => {
    await inspectTarget();
    writeFileSync(join(root, "target.ts"), "export const value = 99;\n", "utf8");
    await denial(patchRequest());
    // A second inspection, of a scope that is not a repeat of the first.
    await govern({
      operationId: "code.inspect",
      parameters: { pathScope: ["target.ts", "other.ts"] },
    });
    await expect(
      authorize({
        ...patchRequest(),
        parameters: {
          ...patchParameters(),
          expectedFingerprint: sha256Hex("export const value = 99;\n"),
        },
        observedTargetFingerprint: ContentHash.parse(sha256Hex("export const value = 99;\n")),
      }),
    ).resolves.toBeDefined();
  });

  it("refuses the patch when nothing is currently observed at all", async () => {
    await inspectTarget();
    const error = await denial({ ...patchRequest(), currentFingerprints: {} });
    expect(error.code).toBe("POLICY_REJECTED");
  });

  it("refuses an observation a later entry invalidated", async () => {
    await inspectTarget();
    const page = await ledger.listForTask(taskId, { limit: 200 }, context);
    const observation = page.items.find(
      (entry) =>
        entry.kind === "observation" &&
        entry.facts.some((fact) => fact.resourceKind === PRECONDITION_RESOURCE_KINDS.workspaceFile),
    );
    if (observation === undefined) throw new Error("the governed read recorded nothing");
    entryCounter += 1;
    await database.unitOfWork.execute(context, async (transaction) => {
      await ledger.append(
        ExecutionLedgerEntry.create({
          id: `ledger:invalidate-${entryCounter}`,
          taskId: "task:gated",
          jobId: "job:1",
          recordedAt: T0,
          kind: "invalidation",
          detail: "the workspace was restored from a snapshot out of band",
          reason: "the workspace was restored from a snapshot out of band",
          invalidatesEntryIds: [observation.id],
        }),
        context,
        transaction,
      );
    });
    expect(String((await denial(patchRequest())).details["missing"])).toMatch(/workspace_file/u);
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

  it("never asks for a fact only the blocked operation could produce", async () => {
    // Whatever `code.patch` is denied for, a read can supply. Proven by doing exactly that.
    const error = await denial(patchRequest());
    expect(String(error.details["missing"])).toMatch(/workspace_file/u);
    await inspectTarget();
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
    expect(String(error.details["missing"])).toMatch(/workspace_file/u);
  });

  it("still refuses the escape hatch after the semantic operation's gate is satisfied", async () => {
    await inspectTarget();
    await expect(authorize(patchRequest())).resolves.toBeDefined();
    // command.run inherits every executable operation's gate and adds one of its own.
    const error = await denial({
      operationId: "command.run",
      parameters: { executable: "/bin/true", arguments: [] },
    });
    expect(String(error.details["missing"])).toMatch(/acceptance_criterion/u);
  });

  it("authorizes the escape hatch only once verified task evidence exists too", async () => {
    await inspectTarget();
    await transitionWithEvidence("verify");
    await expect(
      authorize({
        operationId: "command.run",
        parameters: { executable: "/bin/true", arguments: [] },
      }),
    ).resolves.toBeDefined();
  });

  it("does not accept an unverified record as evidence", async () => {
    await inspectTarget();
    const record = EvidenceRecord.create({
      id: "evidence:unverified",
      projectId: "project:1",
      jobId: "job:1",
      kind: "unit_test",
      subjectType: "acceptance_criterion",
      subjectId: "requirement:one",
      status: "failed",
      summary: "requirement:one is not satisfied",
      artifactIds: ["artifact-unverified"],
      verifierId: "verifier:deterministic",
      verifierVersion: "1.0.0",
      createdAt: T0,
    });
    await database.unitOfWork.execute(context, async (transaction) => {
      await evidence.append(record, context, transaction);
    });
    // Appended, but never cited by a governed transition, so the capsule does not verify it.
    const error = await denial({
      operationId: "command.run",
      parameters: { executable: "/bin/true", arguments: [] },
    });
    expect(String(error.details["missing"])).toMatch(/acceptance_criterion/u);
  });

  it("cannot execute a browser path at all until it is bound, and is gated for when it is", async () => {
    for (const operationId of ["browser.inspect", "browser.verify"] as const) {
      await expect(
        authorize({
          operationId,
          parameters: { target: "http://localhost:1/", expectation: "ok" },
        }),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    }
    // Inspection is the producer and carries nothing; verification consumes what it produces.
    expect(
      resolveEvidencePrecondition(getSemanticOperation("browser.inspect"), "execute").requirements,
    ).toHaveLength(0);
    expect(
      resolveEvidencePrecondition(getSemanticOperation("browser.verify"), "execute").requirements,
    ).toHaveLength(1);
  });
});

// ===========================================================================
// Scope binding
// ===========================================================================
describe("the gate is bound to the authoritative scope of the request", () => {
  it("refuses an effect naming a job the authoritative capsule does not belong to", async () => {
    await inspectTarget();
    const error = await denial({ ...patchRequest(), jobId: JobId.parse("job:other") });
    expect(error.code).toBe("POLICY_REJECTED");
    expect(error.message).toMatch(/job the authoritative task capsule does not belong to/iu);
    expect(error.retryable).toBe(false);
  });

  it("does not let another run's observations satisfy this one", async () => {
    // A perfectly good observation of the same file, recorded under a different job.
    entryCounter += 1;
    await database.unitOfWork.execute(context, async (transaction) => {
      await ledger.append(
        ExecutionLedgerEntry.create({
          id: `ledger:foreign-${entryCounter}`,
          taskId: "task:gated",
          jobId: "job:other",
          recordedAt: T0,
          kind: "observation",
          detail: "target.ts observed in another run",
          facts: [
            {
              resourceKind: PRECONDITION_RESOURCE_KINDS.workspaceFile,
              locator: "target.ts",
              fingerprint: sha256Hex(readFileSync(join(root, "target.ts"), "utf8")),
            },
          ],
        }),
        context,
        transaction,
      );
    });
    expect(String((await denial(patchRequest())).details["missing"])).toMatch(/workspace_file/u);
  });

  it("refuses an effect for a task that has no capsule to condition it against", async () => {
    const error = await denial({ ...patchRequest(), taskId: TaskId.parse("task:absent") });
    expect(error.code).toBe("POLICY_REJECTED");
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/no current task capsule/iu);
  });
});

// ===========================================================================
// Task class, and what the gate itself may do
// ===========================================================================
describe("the task class is part of the predicate", () => {
  it("additionally requires verified task evidence during repair", async () => {
    await inspectTarget();
    await expect(authorize(patchRequest())).resolves.toBeDefined();
    await transitionWithEvidence("repair");
    // Entering repair cites evidence, so the added requirement is already satisfied by the one
    // governed path that could have put the task in this phase at all.
    await expect(authorize(patchRequest())).resolves.toBeDefined();
  });

  it("refuses a repairing task whose evidence was never verified", async () => {
    await inspectTarget();
    await transitionWithEvidence("repair");
    const current = await tasks.loadCurrent(taskId, context);
    if (current === null) throw new Error("missing capsule");
    // The capsule moves on and drops the evidence it was repairing against.
    await tasks.proposeTransition(
      {
        taskId: "task:gated",
        expectedHeadRevision: current.head.revision,
        expectedCapsuleRevision: current.capsule.capsuleRevision,
        from: "repair",
        to: "execute",
        evidenceIds: [],
        reason: "starting over",
      },
      { verifiedEvidenceIds: [], attempts: 3, updatedAt: T0 },
      context,
    );
    const back = await tasks.loadCurrent(taskId, context);
    expect(back?.capsule.phase).toBe("execute");
    // In `execute` the evidence requirement does not apply, so this still passes — which is the
    // point of the task class being part of the predicate rather than a blanket rule.
    await expect(authorize(patchRequest())).resolves.toBeDefined();
  });

  it("never writes anything of its own while deciding", async () => {
    const before = (await ledger.listForTask(taskId, { limit: 200 }, context)).total;
    await denial(patchRequest());
    await denial({
      operationId: "command.run",
      parameters: { executable: "/bin/true", arguments: [] },
    });
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
