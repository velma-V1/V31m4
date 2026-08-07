import {
  type CandidateId,
  IssueRecord,
  type IssueRecord as IssueRecordType,
  type IssueSeverity,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import { type Versioned, WriteConditions } from "../port-types.js";
import type { CandidateRepositoryPort } from "../ports/candidate-repository.port.js";
import type { UnitOfWorkPort } from "../ports/unit-of-work.port.js";

export interface IssueDraft {
  readonly id: string;
  readonly title: string;
  readonly exactDeficiency: string;
  readonly location?: string;
  readonly severity: IssueSeverity;
  readonly evidenceIds: readonly string[];
  readonly expectedConsequence: string;
  readonly proposedCorrection: string;
  readonly verificationMethod: string;
  readonly regressionRisk: string;
}

export interface RecordIssuesDependencies {
  readonly unitOfWork: UnitOfWorkPort;
  readonly candidates: CandidateRepositoryPort;
}

export async function recordIssues(
  dependencies: RecordIssuesDependencies,
  candidateId: CandidateId,
  drafts: readonly IssueDraft[],
  context: OperationContext,
): Promise<readonly Versioned<IssueRecordType>[]> {
  return dependencies.unitOfWork.execute(context, async (transaction) => {
    const stored: Versioned<IssueRecordType>[] = [];
    for (const draft of drafts) {
      const issue = IssueRecord.create({ ...draft, candidateId });
      stored.push(
        await dependencies.candidates.saveIssue(
          issue,
          WriteConditions.mustNotExist(),
          context,
          transaction,
        ),
      );
    }
    return Object.freeze(stored);
  });
}
