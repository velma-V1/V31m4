import { describe, expect, it } from "vitest";
import type {
  ApprovalStorePort,
  ArtifactStorePort,
  AuditStorePort,
  BackupStorePort,
  CandidateRepositoryPort,
  CapabilityRepositoryPort,
  ClockPort,
  ConfigurationStorePort,
  EventBusPort,
  EvidenceRepositoryPort,
  JobRepositoryPort,
  MissionRepositoryPort,
  ModelGatewayPort,
  PluginRegistryPort,
  PolicyEnginePort,
  ProductionKernelPort,
  ProjectRepositoryPort,
  ResourceMonitorPort,
  SchedulerPort,
  SecretStorePort,
  ToolGatewayPort,
  TrainingStorePort,
  UnitOfWorkPort,
  VerifierPort,
  WorkflowRepositoryPort,
  WorkspaceManagerPort,
} from "../src/index.js";
import { WriteConditions } from "../src/index.js";

type AllPorts = readonly [
  UnitOfWorkPort,
  ProjectRepositoryPort,
  MissionRepositoryPort,
  JobRepositoryPort,
  EvidenceRepositoryPort,
  CandidateRepositoryPort,
  CapabilityRepositoryPort,
  ArtifactStorePort,
  EventBusPort,
  ModelGatewayPort,
  ToolGatewayPort,
  PluginRegistryPort,
  ProductionKernelPort,
  VerifierPort,
  PolicyEnginePort,
  SchedulerPort,
  ResourceMonitorPort,
  TrainingStorePort,
  SecretStorePort,
  ClockPort,
  WorkflowRepositoryPort,
  WorkspaceManagerPort,
  AuditStorePort,
  ApprovalStorePort,
  ConfigurationStorePort,
  BackupStorePort,
];

type ProjectSaveTransactionOptional = undefined extends Parameters<ProjectRepositoryPort["save"]>[3]
  ? true
  : false;
type EvidenceAppendTransactionOptional = undefined extends Parameters<
  EvidenceRepositoryPort["append"]
>[2]
  ? true
  : false;
type EventPublishTransactionOptional = undefined extends Parameters<EventBusPort["publish"]>[2]
  ? true
  : false;

describe("application port surface", () => {
  it("requires transaction participation for authoritative writes", () => {
    const projectTransactionOptional: ProjectSaveTransactionOptional = false;
    const evidenceTransactionOptional: EvidenceAppendTransactionOptional = false;
    const eventTransactionOptional: EventPublishTransactionOptional = false;
    expect(projectTransactionOptional).toBe(false);
    expect(evidenceTransactionOptional).toBe(false);
    expect(eventTransactionOptional).toBe(false);
  });

  it("creates immutable optimistic-concurrency conditions", () => {
    expect(WriteConditions.any()).toEqual({ kind: "any" });
    expect(WriteConditions.mustNotExist()).toEqual({ kind: "must_not_exist" });
    expect(WriteConditions.matchRevision("revision-1")).toEqual({
      kind: "match_revision",
      revision: "revision-1",
    });
    expect(Object.isFrozen(WriteConditions.matchRevision("revision-1"))).toBe(true);
    expect(() => WriteConditions.matchRevision("bad revision")).toThrow();
  });

  it("contains the complete Layer 4 port set", () => {
    const count: AllPorts["length"] = 26;
    expect(count).toBe(26);
  });
});
