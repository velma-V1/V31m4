import { assertDomain } from "../domain-errors.js";
import {
  MissionId,
  type MissionId as MissionIdType,
  ProjectId,
  type ProjectId as ProjectIdType,
} from "../value-objects/ids.js";
import {
  ResourceBudget,
  type ResourceBudget as ResourceBudgetType,
} from "../value-objects/resource-budget.js";
import type { EvidenceKind } from "./evidence-record.js";
import { Requirement, type Requirement as RequirementType } from "./requirement.js";

export interface RequiredOutput {
  readonly id: string;
  readonly kind: string;
  readonly description: string;
  readonly requiredFormat?: string;
}

export interface MissionConstraint {
  readonly id: string;
  readonly statement: string;
  readonly category:
    | "architecture"
    | "behavior"
    | "performance"
    | "resource"
    | "compatibility"
    | "security";
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly statement: string;
  readonly verificationMethod: string;
  readonly mandatory: boolean;
}

export interface ForbiddenChange {
  readonly id: string;
  readonly statement: string;
}

export interface EvidenceRequirement {
  readonly criterionId: string;
  readonly requiredEvidenceKinds: readonly EvidenceKind[];
}

export interface MissionContract {
  readonly id: MissionIdType;
  readonly projectId: ProjectIdType;
  readonly title: string;
  readonly objective: string;
  readonly requiredOutputs: readonly RequiredOutput[];
  readonly requirements: readonly RequirementType[];
  readonly constraints: readonly MissionConstraint[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly forbiddenChanges: readonly ForbiddenChange[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly resourceBudget: ResourceBudgetType;
  readonly createdAt: string;
  readonly revision: 1;
}

export interface CreateMissionContractInput {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly objective: string;
  readonly requiredOutputs: readonly RequiredOutput[];
  readonly requirements: readonly RequirementType[];
  readonly constraints: readonly MissionConstraint[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly forbiddenChanges: readonly ForbiddenChange[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly resourceBudget: ResourceBudgetType;
  readonly createdAt: string;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONSTRAINT_CATEGORIES = new Set<MissionConstraint["category"]>([
  "architecture",
  "behavior",
  "performance",
  "resource",
  "compatibility",
  "security",
]);

function canonicalText(value: string, field: string, maxLength = 8000): string {
  assertDomain(
    value.length > 0 && value === value.trim() && value.length <= maxLength,
    "INVALID_MISSION_CONTRACT",
    `${field} must be canonical and contain between 1 and ${maxLength} characters.`,
    { field, length: value.length },
  );
  return value;
}

function canonicalNestedId(value: string, field: string): string {
  assertDomain(
    ID_PATTERN.test(value) && value === value.trim(),
    "INVALID_MISSION_CONTRACT",
    `${field} must be a canonical durable identifier.`,
    { field, value },
  );
  return value;
}

function assertUniqueIds(values: readonly { readonly id: string }[], field: string): void {
  const ids = values.map((value) => canonicalNestedId(value.id, `${field}.id`));
  assertDomain(
    new Set(ids).size === ids.length,
    "INVALID_MISSION_CONTRACT",
    `${field} IDs must be unique.`,
    { field },
  );
}

function validateTimestamp(value: string): void {
  const parsed = Date.parse(value);
  assertDomain(
    ISO_PATTERN.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    "INVALID_MISSION_CONTRACT",
    "Mission creation time must be canonical UTC ISO-8601 with milliseconds.",
    { createdAt: value },
  );
}

export const MissionContract = Object.freeze({
  create(input: CreateMissionContractInput): MissionContract {
    validateTimestamp(input.createdAt);
    canonicalText(input.title, "title", 240);
    canonicalText(input.objective, "objective");
    assertDomain(
      input.requiredOutputs.length > 0,
      "INVALID_MISSION_CONTRACT",
      "A mission must require at least one output.",
    );
    assertDomain(
      input.requirements.length > 0,
      "INVALID_MISSION_CONTRACT",
      "A mission must contain at least one requirement.",
    );
    assertDomain(
      input.acceptanceCriteria.length > 0,
      "INVALID_MISSION_CONTRACT",
      "A mission must contain at least one acceptance criterion.",
    );
    assertUniqueIds(input.requiredOutputs, "requiredOutputs");
    assertUniqueIds(input.requirements, "requirements");
    const requirements = Object.freeze(
      input.requirements.map((value) =>
        Requirement.create({
          id: value.id,
          statement: value.statement,
          priority: value.priority,
          source: value.source,
        }),
      ),
    );
    assertUniqueIds(input.constraints, "constraints");
    assertUniqueIds(input.acceptanceCriteria, "acceptanceCriteria");
    assertUniqueIds(input.forbiddenChanges, "forbiddenChanges");

    const requiredOutputs = Object.freeze(
      input.requiredOutputs.map((value) =>
        Object.freeze({
          id: canonicalNestedId(value.id, "requiredOutput.id"),
          kind: canonicalText(value.kind, "requiredOutput.kind", 120),
          description: canonicalText(value.description, "requiredOutput.description"),
          ...(value.requiredFormat === undefined
            ? {}
            : {
                requiredFormat: canonicalText(
                  value.requiredFormat,
                  "requiredOutput.requiredFormat",
                  240,
                ),
              }),
        }),
      ),
    );

    const constraints = Object.freeze(
      input.constraints.map((value) => {
        assertDomain(
          CONSTRAINT_CATEGORIES.has(value.category),
          "INVALID_MISSION_CONTRACT",
          "Mission constraint category is invalid.",
          { category: value.category },
        );
        return Object.freeze({
          id: canonicalNestedId(value.id, "constraint.id"),
          statement: canonicalText(value.statement, "constraint.statement"),
          category: value.category,
        });
      }),
    );

    const acceptanceCriteria = Object.freeze(
      input.acceptanceCriteria.map((value) =>
        Object.freeze({
          id: canonicalNestedId(value.id, "acceptanceCriterion.id"),
          statement: canonicalText(value.statement, "acceptanceCriterion.statement"),
          verificationMethod: canonicalText(
            value.verificationMethod,
            "acceptanceCriterion.verificationMethod",
          ),
          mandatory: value.mandatory,
        }),
      ),
    );

    const criterionIds = new Set(acceptanceCriteria.map((value) => value.id));
    const evidenceRequirements = Object.freeze(
      input.evidenceRequirements.map((value) => {
        assertDomain(
          criterionIds.has(value.criterionId),
          "INVALID_MISSION_CONTRACT",
          "Evidence requirement references an unknown acceptance criterion.",
          { criterionId: value.criterionId },
        );
        assertDomain(
          value.requiredEvidenceKinds.length > 0,
          "INVALID_MISSION_CONTRACT",
          "Evidence requirements must include at least one evidence kind.",
          { criterionId: value.criterionId },
        );
        return Object.freeze({
          criterionId: value.criterionId,
          requiredEvidenceKinds: Object.freeze([...new Set(value.requiredEvidenceKinds)]),
        });
      }),
    );

    const mandatoryIds = new Set(
      acceptanceCriteria
        .filter((criterion) => criterion.mandatory)
        .map((criterion) => criterion.id),
    );
    const coveredMandatoryIds = new Set(
      evidenceRequirements
        .map((requirement) => requirement.criterionId)
        .filter((criterionId) => mandatoryIds.has(criterionId)),
    );
    assertDomain(
      coveredMandatoryIds.size === mandatoryIds.size,
      "INVALID_MISSION_CONTRACT",
      "Every mandatory acceptance criterion must define evidence requirements.",
    );

    return Object.freeze({
      id: MissionId.parse(input.id),
      projectId: ProjectId.parse(input.projectId),
      title: input.title,
      objective: input.objective,
      requiredOutputs,
      requirements,
      constraints,
      acceptanceCriteria,
      forbiddenChanges: Object.freeze(
        input.forbiddenChanges.map((value) =>
          Object.freeze({
            id: canonicalNestedId(value.id, "forbiddenChange.id"),
            statement: canonicalText(value.statement, "forbiddenChange.statement"),
          }),
        ),
      ),
      evidenceRequirements,
      resourceBudget: ResourceBudget.create(input.resourceBudget),
      createdAt: input.createdAt,
      revision: 1 as const,
    });
  },
});
