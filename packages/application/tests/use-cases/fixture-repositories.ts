import type {
  AvatarState,
  CapabilityProfile,
  ChampionDecision,
  Checkpoint,
  DeliveryReceipt,
  DomainEvent,
  EvidenceRecord,
  IssueRecord,
  Job,
  MissionContract,
  PluginProfile,
  PracticeTask,
  Project,
  PromotionRecord,
  RepairRecord,
  SolverCandidate,
  TrainingPacket,
} from "@v31m4/domain";
import {
  type ApprovalRequest,
  type ApprovalStorePort,
  type AuditRecord,
  type AuditStorePort,
  type CandidateRepositoryPort,
  type CapabilityRepositoryPort,
  type EventBusPort,
  type EvidenceRepositoryPort,
  type JobRepositoryPort,
  type MissionRepositoryPort,
  type PluginRegistryPort,
  type PolicyEnginePort,
  type PracticeRepositoryPort,
  type ProjectRepositoryPort,
  type TrainingStorePort,
  type Versioned,
} from "../../src/index.js";
import { PluginProfile as PluginProfileEntity } from "@v31m4/domain";
import { assertCondition, nextRevision, versioned } from "./fixture-core.js";

export interface RepositoryState {
  readonly audits: AuditRecord[];
  readonly events: DomainEvent[];
  readonly projects: Map<string, Versioned<Project>>;
  readonly missions: Map<string, Versioned<MissionContract>>;
  readonly jobs: Map<string, Versioned<Job>>;
  readonly checkpoints: Map<string, Versioned<Checkpoint>>;
  readonly evidenceRecords: Map<string, Versioned<EvidenceRecord>>;
  readonly candidates: Map<string, Versioned<SolverCandidate>>;
  readonly issues: Map<string, Versioned<IssueRecord>>;
  readonly repairs: Map<string, Versioned<RepairRecord>>;
  readonly decisions: Map<string, Versioned<ChampionDecision>>;
  readonly receipts: Map<string, Versioned<DeliveryReceipt>>;
  readonly capabilities: Map<string, Versioned<CapabilityProfile>>;
  readonly avatars: Map<string, Versioned<AvatarState>>;
  readonly promotions: Versioned<PromotionRecord>[];
  readonly packets: Map<string, Versioned<TrainingPacket>>;
  readonly practices: Map<string, Versioned<PracticeTask>>;
  readonly approvals: Map<string, Versioned<ApprovalRequest>>;
  readonly plugins: Map<string, Versioned<PluginProfile>>;
  policyDecision: "allow" | "deny" | "require_approval";
}

export function createRepositoryPorts(state: RepositoryState) {
  const policy: PolicyEnginePort = {
    evaluate: async () => ({
      decision: state.policyDecision,
      policyId: "policy-1",
      reasons: state.policyDecision === "deny" ? ["denied"] : [],
      requiredApprovalScopes: state.policyDecision === "require_approval" ? ["execute"] : [],
    }),
  };

  const approvalStore: ApprovalStorePort = {
    get: async (id) => state.approvals.get(id) ?? null,
    list: async () => ({ items: [...state.approvals.values()] }),
    save: async (request, condition) => {
      const current = state.approvals.get(request.id);
      assertCondition(current, condition);
      const stored = versioned(request, nextRevision(current));
      state.approvals.set(request.id, stored);
      return stored;
    },
    consume: async (id, condition) => {
      const current = state.approvals.get(id);
      if (current === undefined) throw new Error("approval missing");
      assertCondition(current, condition);
      const stored = versioned(Object.freeze({ ...current.value, status: "consumed" as const }), nextRevision(current));
      state.approvals.set(id, stored);
      return stored;
    },
  };

  const audit: AuditStorePort = {
    append: async (record) => { state.audits.push(record); },
    list: async () => ({ items: [...state.audits] }),
  };

  const projectRepository: ProjectRepositoryPort = {
    getById: async (id) => state.projects.get(id) ?? null,
    list: async () => ({ items: [...state.projects.values()] }),
    save: async (project, condition) => {
      const current = state.projects.get(project.id);
      assertCondition(current, condition);
      const stored = versioned(project, nextRevision(current));
      state.projects.set(project.id, stored);
      return stored;
    },
  };

  const missionRepository: MissionRepositoryPort = {
    getById: async (id) => state.missions.get(id) ?? null,
    listByProject: async (projectId) => ({ items: [...state.missions.values()].filter((item) => item.value.projectId === projectId) }),
    append: async (mission) => {
      if (state.missions.has(mission.id)) throw new Error("mission exists");
      const stored = versioned(mission);
      state.missions.set(mission.id, stored);
      return stored;
    },
  };

  const jobRepository: JobRepositoryPort = {
    getById: async (id) => state.jobs.get(id) ?? null,
    list: async () => ({ items: [...state.jobs.values()] }),
    save: async (job, condition) => {
      const current = state.jobs.get(job.id);
      assertCondition(current, condition);
      const stored = versioned(job, nextRevision(current));
      state.jobs.set(job.id, stored);
      return stored;
    },
    appendCheckpoint: async (checkpoint) => {
      if (state.checkpoints.has(checkpoint.id)) throw new Error("checkpoint exists");
      const stored = versioned(checkpoint);
      state.checkpoints.set(checkpoint.id, stored);
      return stored;
    },
    getCheckpoint: async (id) => state.checkpoints.get(id) ?? null,
    getLatestVerifiedCheckpoint: async (jobId) =>
      [...state.checkpoints.values()].reverse().find((item) => item.value.jobId === jobId && item.value.verified) ?? null,
  };

  const eventBus: EventBusPort = {
    publish: async (events) => { state.events.push(...events); },
    subscribe: async () => ({ id: "subscription-1", async close() {} }),
  };

  const evidenceRepository: EvidenceRepositoryPort = {
    getById: async (id) => state.evidenceRecords.get(id) ?? null,
    list: async (query) => ({
      items: [...state.evidenceRecords.values()].filter((item) => query.statuses === undefined || query.statuses.includes(item.value.status)),
    }),
    append: async (record) => {
      if (state.evidenceRecords.has(record.id)) throw new Error("evidence exists");
      const stored = versioned(record);
      state.evidenceRecords.set(record.id, stored);
      return stored;
    },
  };

  const candidateRepository: CandidateRepositoryPort = {
    getCandidate: async (id) => state.candidates.get(id) ?? null,
    listCandidates: async (missionId) => ({ items: [...state.candidates.values()].filter((item) => item.value.missionId === missionId) }),
    appendCandidate: async (candidate) => {
      if (state.candidates.has(candidate.id)) throw new Error("candidate exists");
      const stored = versioned(candidate);
      state.candidates.set(candidate.id, stored);
      return stored;
    },
    getIssue: async (id) => state.issues.get(id) ?? null,
    listIssues: async (candidateId) => ({ items: [...state.issues.values()].filter((item) => item.value.candidateId === candidateId) }),
    saveIssue: async (issue, condition) => {
      const current = state.issues.get(issue.id);
      assertCondition(current, condition);
      const stored = versioned(issue, nextRevision(current));
      state.issues.set(issue.id, stored);
      return stored;
    },
    appendRepair: async (repair) => {
      const stored = versioned(repair);
      state.repairs.set(repair.id, stored);
      return stored;
    },
    saveChampionDecision: async (decision) => {
      const stored = versioned(decision, nextRevision(state.decisions.get(decision.missionId)));
      state.decisions.set(decision.missionId, stored);
      return stored;
    },
    getChampionDecision: async (missionId) => state.decisions.get(missionId) ?? null,
    saveDeliveryReceipt: async (receipt) => {
      const stored = versioned(receipt, nextRevision(state.receipts.get(receipt.missionId)));
      state.receipts.set(receipt.missionId, stored);
      return stored;
    },
    getDeliveryReceipt: async (missionId) => state.receipts.get(missionId) ?? null,
  };

  const capabilityRepository: CapabilityRepositoryPort = {
    getProfile: async (id) => state.capabilities.get(id) ?? null,
    listProfiles: async () => ({ items: [...state.capabilities.values()] }),
    saveProfile: async (profile, condition) => {
      const current = state.capabilities.get(profile.capabilityId);
      assertCondition(current, condition);
      const stored = versioned(profile, nextRevision(current));
      state.capabilities.set(profile.capabilityId, stored);
      return stored;
    },
    appendPromotion: async (record) => {
      const stored = versioned(record);
      state.promotions.push(stored);
      return stored;
    },
    listPromotions: async () => ({ items: [...state.promotions] }),
    getAvatar: async (id) => state.avatars.get(id) ?? null,
    saveAvatar: async (avatar, condition) => {
      const current = state.avatars.get(avatar.avatarId);
      assertCondition(current, condition);
      const stored = versioned(avatar, nextRevision(current));
      state.avatars.set(avatar.avatarId, stored);
      return stored;
    },
  };

  const trainingStore: TrainingStorePort = {
    get: async (id) => state.packets.get(id) ?? null,
    list: async (status) => ({ items: [...state.packets.values()].filter((item) => status === undefined || item.value.status === status) }),
    save: async (packet, condition) => {
      const current = state.packets.get(packet.id);
      assertCondition(current, condition);
      const stored = versioned(packet, nextRevision(current));
      state.packets.set(packet.id, stored);
      return stored;
    },
  };

  const practiceRepository: PracticeRepositoryPort = {
    get: async (id) => state.practices.get(id) ?? null,
    list: async (status) => ({ items: [...state.practices.values()].filter((item) => status === undefined || item.value.status === status) }),
    save: async (task, condition) => {
      const current = state.practices.get(task.id);
      assertCondition(current, condition);
      const stored = versioned(task, nextRevision(current));
      state.practices.set(task.id, stored);
      return stored;
    },
  };

  const pluginRegistry: PluginRegistryPort = {
    register: async (manifest) => {
      const profile = PluginProfileEntity.create({
        pluginId: manifest.pluginId,
        version: manifest.version,
        status: "registered",
        capabilities: manifest.capabilities,
        requiredToolIds: manifest.requiredToolIds,
        optionalToolIds: manifest.optionalToolIds,
      });
      const stored = versioned(profile);
      state.plugins.set(profile.pluginId, stored);
      return stored;
    },
    get: async (id) => state.plugins.get(id) ?? null,
    list: async () => ({ items: [...state.plugins.values()] }),
    setStatus: async (id, status, condition) => {
      const current = state.plugins.get(id);
      if (current === undefined) throw new Error("plugin missing");
      assertCondition(current, condition);
      const profile = PluginProfileEntity.setStatus(current.value, status);
      const stored = versioned(profile, nextRevision(current));
      state.plugins.set(id, stored);
      return stored;
    },
    findByCapability: async (id) => [...state.plugins.values()].map((item) => item.value).filter((item) => item.capabilities.includes(id)),
    health: async () => ({ status: "healthy", checkedAt: "2026-08-06T20:00:00.000Z", details: {} }),
  };

  return Object.freeze({
    policy,
    approvalStore,
    audit,
    projectRepository,
    missionRepository,
    jobRepository,
    eventBus,
    evidenceRepository,
    candidateRepository,
    capabilityRepository,
    trainingStore,
    practiceRepository,
    pluginRegistry,
  });
}
