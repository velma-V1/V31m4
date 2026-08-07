import type { MissionContract } from "@v31m4/domain";
import { ApplicationError } from "../application-errors.js";
import { canonicalStringify, stableFingerprint, stableSortBy } from "./internal/deterministic.js";

/**
 * Context Compiler.
 *
 * Builds the smallest sufficient, deterministic context package for a task. Mandatory
 * mission material (objective, constraints, forbidden changes, mandatory acceptance
 * criteria and their evidence rules) is always included. Optional supplemental material
 * is added by relevance until the token limit is reached, and everything pruned is
 * reported. When mandatory material alone cannot fit, the service reports the shortfall
 * instead of silently dropping a hard constraint.
 */

export type ContextSectionKind =
  | "objective"
  | "constraint"
  | "forbidden_change"
  | "evidence_rule"
  | "acceptance_criterion"
  | "requirement"
  | "artifact"
  | "issue"
  | "repair";

export interface ContextCandidate {
  readonly kind: ContextSectionKind;
  readonly id: string;
  readonly content: string;
  readonly provenance: string;
  /** Relevance in the inclusive range [0, 1]; higher wins scarce space. */
  readonly relevance: number;
  /** Optional explicit token weight; estimated from content length when omitted. */
  readonly sizeTokens?: number;
}

export interface ContextCompilerInput {
  readonly mission: MissionContract;
  readonly limitTokens: number;
  readonly supplemental?: readonly ContextCandidate[];
}

export interface CompiledContextItem {
  readonly kind: ContextSectionKind;
  readonly id: string;
  readonly content: string;
  readonly provenance: string;
  readonly tokens: number;
  readonly mandatory: boolean;
}

export interface OmittedContextItem {
  readonly kind: ContextSectionKind;
  readonly id: string;
  readonly relevance: number;
  readonly tokens: number;
  readonly reason: "token_limit" | "duplicate";
}

export interface CompiledContext {
  readonly outcome: "compiled";
  readonly items: readonly CompiledContextItem[];
  readonly mandatoryTokens: number;
  readonly includedTokens: number;
  readonly limitTokens: number;
  readonly omittedOptional: readonly OmittedContextItem[];
  readonly fingerprint: string;
}

export interface InsufficientContext {
  readonly outcome: "mandatory_context_exceeds_limit";
  readonly mandatoryTokens: number;
  readonly limitTokens: number;
  readonly mandatoryItems: readonly CompiledContextItem[];
}

export type ContextCompilerResult = CompiledContext | InsufficientContext;

const CHARS_PER_TOKEN = 4;
const SECTION_ORDER: Readonly<Record<ContextSectionKind, number>> = {
  objective: 0,
  constraint: 1,
  forbidden_change: 2,
  evidence_rule: 3,
  acceptance_criterion: 4,
  requirement: 5,
  artifact: 6,
  issue: 7,
  repair: 8,
};

function estimateTokens(content: string, explicit?: number): number {
  if (explicit !== undefined) {
    if (!Number.isSafeInteger(explicit) || explicit < 0) {
      throw new ApplicationError(
        "INVALID_APPLICATION_INPUT",
        "sizeTokens must be a non-negative safe integer when provided.",
      );
    }
    return explicit;
  }
  return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
}

function mandatoryItem(
  kind: ContextSectionKind,
  id: string,
  content: string,
  provenance: string,
): CompiledContextItem {
  return Object.freeze({
    kind,
    id,
    content,
    provenance,
    tokens: estimateTokens(content),
    mandatory: true,
  });
}

function collectMandatory(mission: MissionContract): CompiledContextItem[] {
  const items: CompiledContextItem[] = [
    mandatoryItem("objective", mission.id, mission.objective, `mission:${mission.id}`),
  ];
  for (const constraint of mission.constraints) {
    items.push(
      mandatoryItem(
        "constraint",
        constraint.id,
        constraint.statement,
        `constraint:${constraint.id}`,
      ),
    );
  }
  for (const forbidden of mission.forbiddenChanges) {
    items.push(
      mandatoryItem(
        "forbidden_change",
        forbidden.id,
        forbidden.statement,
        `forbidden_change:${forbidden.id}`,
      ),
    );
  }
  const mandatoryCriterionIds = new Set<string>();
  for (const criterion of mission.acceptanceCriteria) {
    if (criterion.mandatory) {
      mandatoryCriterionIds.add(criterion.id);
      items.push(
        mandatoryItem(
          "acceptance_criterion",
          criterion.id,
          `${criterion.statement} :: ${criterion.verificationMethod}`,
          `criterion:${criterion.id}`,
        ),
      );
    }
  }
  for (const requirement of mission.evidenceRequirements) {
    if (mandatoryCriterionIds.has(requirement.criterionId)) {
      items.push(
        mandatoryItem(
          "evidence_rule",
          requirement.criterionId,
          requirement.requiredEvidenceKinds.join(","),
          `evidence_rule:${requirement.criterionId}`,
        ),
      );
    }
  }
  return items;
}

function collectOptional(
  mission: MissionContract,
  supplemental: readonly ContextCandidate[],
): ContextCandidate[] {
  const optional: ContextCandidate[] = [];
  for (const criterion of mission.acceptanceCriteria) {
    if (!criterion.mandatory) {
      optional.push({
        kind: "acceptance_criterion",
        id: criterion.id,
        content: `${criterion.statement} :: ${criterion.verificationMethod}`,
        provenance: `criterion:${criterion.id}`,
        relevance: 0.5,
      });
    }
  }
  optional.push(...supplemental);
  return optional;
}

function assertRelevance(candidate: ContextCandidate): void {
  if (!Number.isFinite(candidate.relevance) || candidate.relevance < 0 || candidate.relevance > 1) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "Context candidate relevance must be between 0 and 1.",
      { details: { kind: candidate.kind, id: candidate.id } },
    );
  }
}

function fingerprintItems(items: readonly CompiledContextItem[]): string {
  return stableFingerprint(
    canonicalStringify(
      items.map((item) => ({ kind: item.kind, id: item.id, content: item.content })),
    ),
  );
}

function orderItems(items: readonly CompiledContextItem[]): CompiledContextItem[] {
  return stableSortBy(items, (item) => `${SECTION_ORDER[item.kind]}:${item.id}`);
}

/** Compiles the smallest sufficient deterministic context for a mission task. */
export function compileContext(input: ContextCompilerInput): ContextCompilerResult {
  if (!Number.isSafeInteger(input.limitTokens) || input.limitTokens <= 0) {
    throw new ApplicationError(
      "INVALID_APPLICATION_INPUT",
      "limitTokens must be a positive safe integer.",
    );
  }

  const mandatory = collectMandatory(input.mission);
  const mandatoryTokens = mandatory.reduce((sum, item) => sum + item.tokens, 0);
  if (mandatoryTokens > input.limitTokens) {
    return Object.freeze({
      outcome: "mandatory_context_exceeds_limit",
      mandatoryTokens,
      limitTokens: input.limitTokens,
      mandatoryItems: Object.freeze(orderItems(mandatory)),
    });
  }

  const optional = collectOptional(input.mission, input.supplemental ?? []);
  for (const candidate of optional) {
    assertRelevance(candidate);
  }

  // Deterministic priority: relevance descending, then section order, then id.
  const prioritised = stableSortBy(
    optional,
    (candidate) =>
      `${(1 - candidate.relevance).toFixed(6)}:${SECTION_ORDER[candidate.kind]}:${candidate.id}`,
  );

  const included: CompiledContextItem[] = [...mandatory];
  const omitted: OmittedContextItem[] = [];
  const seen = new Set(mandatory.map((item) => `${item.kind}:${item.id}`));
  let usedTokens = mandatoryTokens;

  for (const candidate of prioritised) {
    const key = `${candidate.kind}:${candidate.id}`;
    const tokens = estimateTokens(candidate.content, candidate.sizeTokens);
    if (seen.has(key)) {
      omitted.push(
        Object.freeze({
          kind: candidate.kind,
          id: candidate.id,
          relevance: candidate.relevance,
          tokens,
          reason: "duplicate",
        }),
      );
      continue;
    }
    if (usedTokens + tokens > input.limitTokens) {
      omitted.push(
        Object.freeze({
          kind: candidate.kind,
          id: candidate.id,
          relevance: candidate.relevance,
          tokens,
          reason: "token_limit",
        }),
      );
      continue;
    }
    seen.add(key);
    usedTokens += tokens;
    included.push(
      Object.freeze({
        kind: candidate.kind,
        id: candidate.id,
        content: candidate.content,
        provenance: candidate.provenance,
        tokens,
        mandatory: false,
      }),
    );
  }

  const ordered = orderItems(included);
  return Object.freeze({
    outcome: "compiled",
    items: Object.freeze(ordered),
    mandatoryTokens,
    includedTokens: usedTokens,
    limitTokens: input.limitTokens,
    omittedOptional: Object.freeze(omitted),
    fingerprint: fingerprintItems(ordered),
  });
}

export const ContextCompiler = Object.freeze({ compile: compileContext });
