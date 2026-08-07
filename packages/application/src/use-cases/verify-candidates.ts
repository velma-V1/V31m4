import type {
  EvidenceRecord,
  SolverCandidate,
  VerificationPlan,
  VerificationResult,
} from "@v31m4/domain";
import { assertApplication } from "../application-errors.js";
import type { OperationContext } from "../operation-context.js";
import { throwIfOperationCancelled } from "../operation-context.js";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";
import type { VerifierPort } from "../ports/verifier.port.js";

export interface VerifyCandidatesDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly evidence: EvidenceRepositoryPort;
  readonly verifier: VerifierPort;
}

export interface CandidateVerificationRequest {
  readonly plan: VerificationPlan;
  readonly candidate: SolverCandidate;
}

export interface CandidateVerificationOutcome {
  readonly candidate: SolverCandidate;
  readonly result: VerificationResult;
  readonly evidence: readonly EvidenceRecord[];
}

export async function verifyCandidates(
  dependencies: VerifyCandidatesDependencies,
  requests: readonly CandidateVerificationRequest[],
  context: OperationContext,
): Promise<readonly CandidateVerificationOutcome[]> {
  assertApplication(
    requests.length > 0,
    "INVALID_APPLICATION_INPUT",
    "At least one candidate verification is required.",
  );
  const outcomes: CandidateVerificationOutcome[] = [];
  for (const request of requests) {
    throwIfOperationCancelled(context);
    assertApplication(
      request.plan.candidateId === request.candidate.id,
      "INTEGRITY_FAILURE",
      "Verification plan belongs to a different candidate.",
    );
    const execution = await dependencies.verifier.execute(request.plan, request.candidate, context);
    assertApplication(
      execution.candidateId === request.candidate.id &&
        execution.result.candidateId === request.candidate.id,
      "INTEGRITY_FAILURE",
      "Verifier returned a result for a different candidate.",
    );
    await dependencies.unitOfWork.execute(context, async (transaction) => {
      for (const record of execution.evidence) {
        await dependencies.evidence.append(record, context, transaction);
      }
    });
    outcomes.push(
      Object.freeze({
        candidate: request.candidate,
        result: execution.result,
        evidence: Object.freeze([...execution.evidence]),
      }),
    );
  }
  return Object.freeze(outcomes);
}
