import type { ArtifactId } from "@v31m4/domain";
import { ApplicationError, assertApplication } from "../application-errors.js";

export type ContextItemKind =
  | "objective"
  | "constraint"
  | "acceptance_criterion"
  | "evidence_rule"
  | "requirement"
  | "artifact"
  | "issue"
  | "repair_history";

export interface ContextItem {
  readonly id: string;
  readonly kind: ContextItemKind;
  readonly content: string;
  readonly mandatory: boolean;
  readonly priority: number;
  readonly estimatedTokens: number;
  readonly provenanceArtifactIds: readonly ArtifactId[];
}

export interface CompileContextInput {
  readonly items: readonly ContextItem[];
  readonly maxTokens: number;
}

export interface CompiledContext {
  readonly items: readonly ContextItem[];
  readonly omittedItemIds: readonly string[];
  readonly estimatedTokens: number;
  readonly fingerprint: string;
}

const KIND_ORDER: Readonly<Record<ContextItemKind, number>> = Object.freeze({
  objective: 0,
  constraint: 1,
  acceptance_criterion: 2,
  evidence_rule: 3,
  requirement: 4,
  artifact: 5,
  issue: 6,
  repair_history: 7,
});
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function freezeItem(item: ContextItem): ContextItem {
  return Object.freeze({ ...item, provenanceArtifactIds: Object.freeze([...item.provenanceArtifactIds]) });
}

function fingerprint(items: readonly ContextItem[]): string {
  let hash = 2_166_136_261;
  const text = items.map((item) => `${item.kind}\u0000${item.id}\u0000${item.content}`).join("\u0001");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return `ctx-${hash.toString(16).padStart(8, "0")}`;
}

export function compileContext(input: CompileContextInput): CompiledContext {
  assertApplication(
    Number.isSafeInteger(input.maxTokens) && input.maxTokens > 0,
    "INVALID_APPLICATION_INPUT",
    "Context token limit must be a positive safe integer.",
  );
  const seen = new Set<string>();
  const normalized = input.items.map((item) => {
    assertApplication(ID_PATTERN.test(item.id), "INVALID_APPLICATION_INPUT", "Context item ID is invalid.");
    assertApplication(!seen.has(item.id), "INVALID_APPLICATION_INPUT", "Context item IDs must be unique.", {
      details: { itemId: item.id },
    });
    seen.add(item.id);
    assertApplication(
      item.content.length > 0 && item.content === item.content.trim() && item.content.length <= 100_000,
      "INVALID_APPLICATION_INPUT",
      "Context item content must be canonical and bounded.",
      { details: { itemId: item.id } },
    );
    assertApplication(
      Number.isSafeInteger(item.priority) && item.priority >= 0,
      "INVALID_APPLICATION_INPUT",
      "Context priority must be a non-negative safe integer.",
    );
    assertApplication(
      Number.isSafeInteger(item.estimatedTokens) && item.estimatedTokens > 0,
      "INVALID_APPLICATION_INPUT",
      "Context token estimates must be positive safe integers.",
    );
    return freezeItem(item);
  });

  const mandatory = normalized
    .filter((item) => item.mandatory)
    .sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.id.localeCompare(right.id));
  const mandatoryTokens = mandatory.reduce((total, item) => total + item.estimatedTokens, 0);
  if (mandatoryTokens > input.maxTokens) {
    throw new ApplicationError("RESOURCE_EXHAUSTED", "Mandatory context exceeds the available token limit.", {
      details: { mandatoryTokens, maxTokens: input.maxTokens },
    });
  }

  const optional = normalized
    .filter((item) => !item.mandatory)
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
        left.id.localeCompare(right.id),
    );
  const selected = [...mandatory];
  const omitted: string[] = [];
  let used = mandatoryTokens;
  for (const item of optional) {
    if (used + item.estimatedTokens <= input.maxTokens) {
      selected.push(item);
      used += item.estimatedTokens;
    } else {
      omitted.push(item.id);
    }
  }
  selected.sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.id.localeCompare(right.id));
  return Object.freeze({
    items: Object.freeze(selected),
    omittedItemIds: Object.freeze(omitted.sort()),
    estimatedTokens: used,
    fingerprint: fingerprint(selected),
  });
}
