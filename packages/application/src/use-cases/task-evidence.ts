import { type EvidenceId, type EvidenceRecord, isCanonicalDurableId } from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port.js";
import type { UnitOfWorkTransaction } from "../ports/unit-of-work.port.js";

/**
 * Loads cited evidence from the one authoritative store.
 *
 * Shared by task creation and task transitions so both reach exactly the same records through
 * exactly the same authority — a second resolution path would be a second place for the rules to
 * drift apart. An identifier that is not canonical durable-ID syntax is never handed to the
 * store: it cannot name a real record, and the caller's own validation refuses it anyway.
 */
export async function resolveTaskEvidence(
  evidence: EvidenceRepositoryPort,
  evidenceIds: readonly string[],
  context: OperationContext,
  transaction: UnitOfWorkTransaction,
): Promise<ReadonlyMap<string, EvidenceRecord>> {
  const resolved = new Map<string, EvidenceRecord>();
  for (const evidenceId of evidenceIds) {
    if (!isCanonicalDurableId(evidenceId)) continue;
    const stored = await evidence.getById(evidenceId as EvidenceId, context, transaction);
    if (stored !== null) resolved.set(evidenceId, stored.value);
  }
  return resolved;
}
