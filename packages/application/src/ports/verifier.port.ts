import type {
  CandidateId,
  EvidenceRecord,
  SolverCandidate,
  VerificationPlan,
  VerificationResult,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";

export interface VerificationExecutionResult {
  readonly candidateId: CandidateId;
  readonly result: VerificationResult;
  readonly evidence: readonly EvidenceRecord[];
}

export interface VerifierPort {
  supports(verifierId: string, context: OperationContext): Promise<boolean>;
  execute(plan: VerificationPlan, candidate: SolverCandidate, context: OperationContext): Promise<VerificationExecutionResult>;
  cancel(planId: string, context: OperationContext): Promise<void>;
}
