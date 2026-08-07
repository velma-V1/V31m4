import type {
  CandidateId,
  ChampionDecision,
  DeliveryReceipt,
  IssueId,
  IssueRecord,
  MissionId,
  RepairRecord,
  SolverCandidate,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface CandidateRepositoryPort {
  getCandidate(
    id: CandidateId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<SolverCandidate> | null>;
  listCandidates(
    missionId: MissionId,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<SolverCandidate>>>;
  appendCandidate(
    candidate: SolverCandidate,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<SolverCandidate>>;
  getIssue(
    id: IssueId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<IssueRecord> | null>;
  listIssues(
    candidateId: CandidateId,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<IssueRecord>>>;
  saveIssue(
    issue: IssueRecord,
    condition: WriteCondition,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<IssueRecord>>;
  appendRepair(
    repair: RepairRecord,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<RepairRecord>>;
  saveChampionDecision(
    decision: ChampionDecision,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<ChampionDecision>>;
  getChampionDecision(
    missionId: MissionId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<ChampionDecision> | null>;
  saveDeliveryReceipt(
    receipt: DeliveryReceipt,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<DeliveryReceipt>>;
  getDeliveryReceipt(
    missionId: MissionId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<DeliveryReceipt> | null>;
}
