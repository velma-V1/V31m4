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
import type { ApprovalRequest, AuditRecord, Versioned } from "../../src/index.js";
import { TestClock, TestUnitOfWork } from "./fixture-core.js";
import { createExternalPorts } from "./fixture-external.js";
import { createRepositoryPorts } from "./fixture-repositories.js";

export * from "./fixture-core.js";

export class Harness {
  readonly unitOfWork = new TestUnitOfWork();
  readonly clock = new TestClock();
  readonly audits: AuditRecord[] = [];
  readonly events: DomainEvent[] = [];
  readonly discardedWorkspaces: string[] = [];
  readonly projects = new Map<string, Versioned<Project>>();
  readonly missions = new Map<string, Versioned<MissionContract>>();
  readonly jobs = new Map<string, Versioned<Job>>();
  readonly checkpoints = new Map<string, Versioned<Checkpoint>>();
  readonly evidenceRecords = new Map<string, Versioned<EvidenceRecord>>();
  readonly candidates = new Map<string, Versioned<SolverCandidate>>();
  readonly issues = new Map<string, Versioned<IssueRecord>>();
  readonly repairs = new Map<string, Versioned<RepairRecord>>();
  readonly decisions = new Map<string, Versioned<ChampionDecision>>();
  readonly receipts = new Map<string, Versioned<DeliveryReceipt>>();
  readonly capabilities = new Map<string, Versioned<CapabilityProfile>>();
  readonly avatars = new Map<string, Versioned<AvatarState>>();
  readonly promotions: Versioned<PromotionRecord>[] = [];
  readonly packets = new Map<string, Versioned<TrainingPacket>>();
  readonly practices = new Map<string, Versioned<PracticeTask>>();
  readonly approvals = new Map<string, Versioned<ApprovalRequest>>();
  readonly plugins = new Map<string, Versioned<PluginProfile>>();
  policyDecision: "allow" | "deny" | "require_approval" = "allow";
  kernelFailure: Error | undefined;
  modelFailure: Error | undefined;
  toolFailure: Error | undefined;

  readonly policy;
  readonly approvalStore;
  readonly audit;
  readonly projectRepository;
  readonly missionRepository;
  readonly jobRepository;
  readonly eventBus;
  readonly evidenceRepository;
  readonly candidateRepository;
  readonly capabilityRepository;
  readonly trainingStore;
  readonly practiceRepository;
  readonly pluginRegistry;
  readonly kernel;
  readonly workspaces;
  readonly modelGateway;
  readonly toolGateway;
  readonly verifier;
  readonly resourceMonitor;

  constructor() {
    const repositories = createRepositoryPorts(this);
    this.policy = repositories.policy;
    this.approvalStore = repositories.approvalStore;
    this.audit = repositories.audit;
    this.projectRepository = repositories.projectRepository;
    this.missionRepository = repositories.missionRepository;
    this.jobRepository = repositories.jobRepository;
    this.eventBus = repositories.eventBus;
    this.evidenceRepository = repositories.evidenceRepository;
    this.candidateRepository = repositories.candidateRepository;
    this.capabilityRepository = repositories.capabilityRepository;
    this.trainingStore = repositories.trainingStore;
    this.practiceRepository = repositories.practiceRepository;
    this.pluginRegistry = repositories.pluginRegistry;

    const harness = this;
    const external = createExternalPorts({
      clock: this.clock,
      discardedWorkspaces: this.discardedWorkspaces,
      pluginRegistry: this.pluginRegistry,
      get kernelFailure() {
        return harness.kernelFailure;
      },
      set kernelFailure(value) {
        harness.kernelFailure = value;
      },
      get modelFailure() {
        return harness.modelFailure;
      },
      set modelFailure(value) {
        harness.modelFailure = value;
      },
      get toolFailure() {
        return harness.toolFailure;
      },
      set toolFailure(value) {
        harness.toolFailure = value;
      },
    });
    this.kernel = external.kernel;
    this.workspaces = external.workspaces;
    this.modelGateway = external.modelGateway;
    this.toolGateway = external.toolGateway;
    this.verifier = external.verifier;
    this.resourceMonitor = external.resourceMonitor;
  }
}
