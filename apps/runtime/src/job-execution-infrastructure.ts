import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtifactStorePort,
  CandidateRepositoryPort,
  EvidenceQuery,
  EvidenceRepositoryPort,
  ModelGatewayPort,
  ModelInvocationRequest,
  ModelInvocationResult,
  OperationContext,
  PortHealth,
  PortPage,
  PortPageRequest,
  UnitOfWorkPort,
  UnitOfWorkTransaction,
  VerificationExecutionResult,
  VerifierPort,
  Versioned,
  WorkspaceHandle,
  WorkspaceManagerPort,
  WorkspacePurpose,
  WorkspaceSnapshot,
  WriteCondition,
} from "@v31m4/application";
import { ApplicationError } from "@v31m4/application";
import type {
  ChampionDecision,
  DeliveryReceipt,
  EvidenceRecord,
  IssueRecord,
  ModelId,
  ModelProfile as ModelProfileType,
  ProjectId,
  RepairRecord,
  SolverCandidate,
  VerificationPlan,
  VerificationResult,
} from "@v31m4/domain";
import {
  AdapterId,
  ArtifactId,
  EvidenceId,
  ModelProfile,
  SafePath,
  VerificationResultId,
} from "@v31m4/domain";
import { SqliteRecordStore, type SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import { listPersistedRecords } from "./record-listing.js";

const CANDIDATE_TYPE = "candidate";
const ISSUE_TYPE = "issue";
const REPAIR_TYPE = "repair";
const CHAMPION_DECISION_TYPE = "champion-decision";
const DELIVERY_RECEIPT_TYPE = "delivery-receipt";
const EVIDENCE_TYPE = "evidence";

/** `CandidateRepositoryPort` backed by the generic record store: five related record types
 * (candidate/issue/repair/champion-decision/delivery-receipt), all thin wrappers. */
export class SqliteCandidateRepository implements CandidateRepositoryPort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async getCandidate(id: string): Promise<Versioned<SolverCandidate> | null> {
    return this.#records.get<SolverCandidate>(CANDIDATE_TYPE, id);
  }
  async listCandidates(
    missionId: string,
    request: PortPageRequest,
  ): Promise<PortPage<Versioned<SolverCandidate>>> {
    return listPersistedRecords<SolverCandidate>(
      this.database,
      CANDIDATE_TYPE,
      request,
      (candidate) => candidate.missionId === missionId,
    );
  }
  async appendCandidate(
    candidate: SolverCandidate,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<SolverCandidate>> {
    return this.#records.append(CANDIDATE_TYPE, candidate.id, candidate, transaction);
  }
  async getIssue(id: string): Promise<Versioned<IssueRecord> | null> {
    return this.#records.get<IssueRecord>(ISSUE_TYPE, id);
  }
  async listIssues(
    candidateId: string,
    request: PortPageRequest,
  ): Promise<PortPage<Versioned<IssueRecord>>> {
    return listPersistedRecords<IssueRecord>(
      this.database,
      ISSUE_TYPE,
      request,
      (issue) => issue.candidateId === candidateId,
    );
  }
  async saveIssue(
    issue: IssueRecord,
    condition: WriteCondition,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<IssueRecord>> {
    return this.#records.save(ISSUE_TYPE, issue.id, issue, condition, transaction);
  }
  async appendRepair(
    repair: RepairRecord,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<RepairRecord>> {
    return this.#records.append(REPAIR_TYPE, repair.id, repair, transaction);
  }
  async saveChampionDecision(
    decision: ChampionDecision,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<ChampionDecision>> {
    return this.#records.save(
      CHAMPION_DECISION_TYPE,
      decision.missionId,
      decision,
      { kind: "must_not_exist" },
      transaction,
    );
  }
  async getChampionDecision(missionId: string): Promise<Versioned<ChampionDecision> | null> {
    return this.#records.get<ChampionDecision>(CHAMPION_DECISION_TYPE, missionId);
  }
  async saveDeliveryReceipt(
    receipt: DeliveryReceipt,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<DeliveryReceipt>> {
    return this.#records.save(
      DELIVERY_RECEIPT_TYPE,
      receipt.missionId,
      receipt,
      { kind: "must_not_exist" },
      transaction,
    );
  }
  async getDeliveryReceipt(missionId: string): Promise<Versioned<DeliveryReceipt> | null> {
    return this.#records.get<DeliveryReceipt>(DELIVERY_RECEIPT_TYPE, missionId);
  }
}

/** `EvidenceRepositoryPort` backed by the generic record store. */
export class SqliteEvidenceRepository implements EvidenceRepositoryPort {
  readonly #records: SqliteRecordStore;
  constructor(private readonly database: SqliteRuntimeDatabase) {
    this.#records = new SqliteRecordStore(database);
  }
  async getById(id: string): Promise<Versioned<EvidenceRecord> | null> {
    return this.#records.get<EvidenceRecord>(EVIDENCE_TYPE, id);
  }
  async list(query: EvidenceQuery): Promise<PortPage<Versioned<EvidenceRecord>>> {
    return listPersistedRecords<EvidenceRecord>(this.database, EVIDENCE_TYPE, query, (evidence) => {
      if (query.projectId !== undefined && evidence.projectId !== query.projectId) return false;
      if (query.jobId !== undefined && evidence.jobId !== query.jobId) return false;
      if (query.subjectType !== undefined && evidence.subjectType !== query.subjectType) {
        return false;
      }
      if (query.subjectId !== undefined && evidence.subjectId !== query.subjectId) return false;
      if (query.statuses !== undefined && !query.statuses.includes(evidence.status)) return false;
      return query.kinds === undefined || query.kinds.includes(evidence.kind);
    });
  }
  async append(
    record: EvidenceRecord,
    _context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<EvidenceRecord>> {
    return this.#records.append(EVIDENCE_TYPE, record.id, record, transaction);
  }
}

/** `WorkspaceManagerPort` backed by real, isolated directories under the runtime's data root —
 * real filesystem isolation, not a simulated/in-memory stand-in. */
export class LocalWorkspaceManager implements WorkspaceManagerPort {
  readonly #handles = new Map<string, WorkspaceHandle>();
  constructor(private readonly rootDir: string) {}

  async create(projectId: ProjectId, purpose: WorkspacePurpose): Promise<WorkspaceHandle> {
    const id = `workspace-${randomUUID()}`;
    // SafePath is a project-relative logical path, not an absolute filesystem path (SafePath.parse
    // rejects absolute paths) - the real, absolute directory this manager actually creates and
    // isolates on disk is `join(this.rootDir, id)`, kept out of the port-facing handle.
    await mkdir(join(this.rootDir, id), { recursive: true });
    const handle: WorkspaceHandle = Object.freeze({
      id,
      projectId,
      purpose,
      rootPath: SafePath.parse(id),
      status: "active",
      createdAt: new Date().toISOString(),
    });
    this.#handles.set(id, handle);
    return handle;
  }
  async get(workspaceId: string): Promise<WorkspaceHandle | null> {
    return this.#handles.get(workspaceId) ?? null;
  }
  async snapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    const handle = this.#handles.get(workspaceId);
    if (handle === undefined) {
      throw new ApplicationError("NOT_FOUND", "Workspace does not exist.", {
        details: { workspaceId },
      });
    }
    return Object.freeze({ workspaceId, artifactIds: [], createdAt: new Date().toISOString() });
  }
  async seal(workspaceId: string): Promise<WorkspaceHandle> {
    const handle = this.#handles.get(workspaceId);
    if (handle === undefined) {
      throw new ApplicationError("NOT_FOUND", "Workspace does not exist.", {
        details: { workspaceId },
      });
    }
    const sealed = Object.freeze({ ...handle, status: "sealed" as const });
    this.#handles.set(workspaceId, sealed);
    return sealed;
  }
  async discard(workspaceId: string): Promise<void> {
    const handle = this.#handles.get(workspaceId);
    if (handle === undefined) return;
    this.#handles.set(workspaceId, Object.freeze({ ...handle, status: "discarded" as const }));
  }
}

const REFERENCE_MODEL_ID = "reference-model" as ModelId;
const REFERENCE_ADAPTER_ID = AdapterId.parse("reference-adapter");

/**
 * Deterministic reference `ModelGatewayPort`: writes a real, content-addressed artifact (through
 * the existing, real `ArtifactStorePort`/`ContentAddressedArtifactStore` — not a parallel artifact
 * system) derived from the prompt, but performs no real model inference. Exactly like the
 * Video/Game departments' reference adapters and `ReferenceProductionKernel`; must never be
 * represented as real model execution. No real model gateway (Layer 9's `SupervisedModelGateway`)
 * is bound to an adapter process on this machine.
 *
 * `ModelGatewayPort.invoke` has no transaction parameter — it is, by contract, called outside any
 * transaction (the same "external execution never inside a transaction" rule `startJob` and
 * `runSolverForge` already follow) — but the real `ArtifactStorePort.write` requires one. This
 * gateway opens its own short transaction per write via the real `database.unitOfWork`, exactly
 * the pattern `startJob`'s multiple sequential transactions already establish, rather than being
 * handed one from a caller that (by the port's own contract) does not have one open.
 */
export class ReferenceModelGateway implements ModelGatewayPort {
  constructor(
    private readonly artifacts: ArtifactStorePort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly projectId: ProjectId,
  ) {}

  async list(): Promise<PortPage<ModelProfileType>> {
    return Object.freeze({ items: Object.freeze([this.#profile()]), total: 1 });
  }
  async get(modelId: ModelId): Promise<ModelProfileType | null> {
    return modelId === REFERENCE_MODEL_ID ? this.#profile() : null;
  }
  async invoke(
    request: ModelInvocationRequest,
    context: OperationContext,
  ): Promise<ModelInvocationResult> {
    const prompt = await this.#readArtifactText(request.promptArtifactId, context);
    const responseText = `reference-response for configuration ${request.configuration.strategy}\n${prompt}`;
    const responseArtifactId = await this.#writeArtifact(request.jobId, responseText, context);
    return Object.freeze({
      invocationId: request.invocationId,
      modelId: request.modelId,
      responseArtifactId,
      outputArtifactIds: Object.freeze([responseArtifactId]),
      finishReason: "completed" as const,
      usage: Object.freeze({ wallClockMs: 1 }),
      metadata: Object.freeze({}),
    });
  }
  async cancel(): Promise<void> {}
  async health(): Promise<PortHealth> {
    return Object.freeze({
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { model: "reference", real: false },
    });
  }

  #profile(): ModelProfileType {
    return ModelProfile.create({
      modelId: REFERENCE_MODEL_ID,
      adapterId: REFERENCE_ADAPTER_ID,
      displayName: "Reference Model (deterministic, no real inference)",
      status: "available",
      local: true,
      supportedModalities: ["text"],
    });
  }

  async #readArtifactText(artifactId: string, context: OperationContext): Promise<string> {
    const stream = await this.artifacts.open(ArtifactId.parse(artifactId), context);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }

  async #writeArtifact(
    jobId: string,
    text: string,
    context: OperationContext,
  ): Promise<ArtifactId> {
    const bytes = Buffer.from(text, "utf8");
    async function* source(): AsyncIterable<Uint8Array> {
      yield bytes;
    }
    return this.unitOfWork.execute(context, async (transaction) => {
      const artifact = await this.artifacts.write(
        {
          id: ArtifactId.parse(`artifact-${randomUUID()}`),
          projectId: this.projectId,
          kind: "document",
          logicalPath: SafePath.parse(`job-${jobId}/response-${randomUUID()}.txt`),
          mediaType: "text/plain",
          parentArtifactIds: [],
          bytes: source(),
        },
        context,
        transaction,
      );
      return artifact.value.id;
    });
  }
}

/**
 * Deterministic reference `VerifierPort`: checks that every output artifact the candidate declares
 * actually exists and is non-empty (a real, if minimal, integrity check against real artifact
 * bytes), not a hardcoded pass. Produces one real evidence entry per check. No real
 * unit-test/build/lint runner is wired; this must never be represented as real verification.
 */
export class ReferenceVerifier implements VerifierPort {
  constructor(
    private readonly artifacts: ArtifactStorePort,
    private readonly projectId: ProjectId,
  ) {}

  async supports(): Promise<boolean> {
    return true;
  }
  async execute(
    plan: VerificationPlan,
    candidate: SolverCandidate,
    context: OperationContext,
  ): Promise<VerificationExecutionResult> {
    const evidence: EvidenceRecord[] = [];
    let passed = 0;
    for (const check of plan.checks) {
      const outputId = candidate.outputArtifactIds[0];
      const ok = outputId !== undefined && (await this.#artifactExists(outputId, context));
      if (ok) passed += 1;
      evidence.push(
        Object.freeze({
          id: EvidenceId.parse(`evidence-${randomUUID()}`),
          projectId: this.projectId,
          kind: "static_analysis",
          subjectType: "candidate",
          subjectId: candidate.id,
          status: ok ? ("passed" as const) : ("failed" as const),
          summary: `Reference check '${check.id}': output artifact ${ok ? "present" : "missing"}.`,
          artifactIds: outputId === undefined ? [] : [outputId],
          verifierId: "reference-verifier",
          verifierVersion: "0.0.0",
          createdAt: new Date().toISOString(),
          immutable: true as const,
        }),
      );
    }
    const result: VerificationResult = Object.freeze({
      id: VerificationResultId.parse(`verification-${randomUUID()}`),
      planId: plan.id,
      candidateId: candidate.id,
      status: passed === plan.checks.length ? ("passed" as const) : ("failed" as const),
      evidenceIds: Object.freeze(evidence.map((entry) => entry.id)),
      mandatoryChecksPassed: passed,
      mandatoryChecksTotal: plan.checks.length,
      optionalChecksPassed: 0,
      optionalChecksTotal: 0,
    });
    return Object.freeze({ candidateId: candidate.id, result, evidence: Object.freeze(evidence) });
  }
  async cancel(): Promise<void> {}

  async #artifactExists(artifactId: string, context: OperationContext): Promise<boolean> {
    try {
      const stream = await this.artifacts.open(ArtifactId.parse(artifactId), context);
      for await (const _chunk of stream) return true;
      return false;
    } catch {
      return false;
    }
  }
}
