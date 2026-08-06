import { assertDomain } from "../domain-errors.js";
import {
  RequirementId,
  type RequirementId as RequirementIdType,
} from "../value-objects/ids.js";

export type RequirementPriority = "required" | "important" | "optional";
export type RequirementSource = "user" | "system" | "plugin" | "derived";

export interface Requirement {
  readonly id: RequirementIdType;
  readonly statement: string;
  readonly priority: RequirementPriority;
  readonly source: RequirementSource;
}

export interface CreateRequirementInput {
  readonly id: string;
  readonly statement: string;
  readonly priority: RequirementPriority;
  readonly source: RequirementSource;
}

const PRIORITIES = new Set<RequirementPriority>(["required", "important", "optional"]);
const SOURCES = new Set<RequirementSource>(["user", "system", "plugin", "derived"]);

export const Requirement = Object.freeze({
  create(input: CreateRequirementInput): Requirement {
    assertDomain(
      input.statement.length > 0 &&
        input.statement === input.statement.trim() &&
        input.statement.length <= 4000,
      "INVALID_REQUIREMENT",
      "Requirement statement must be canonical and contain between 1 and 4000 characters.",
      { statementLength: input.statement.length },
    );
    assertDomain(
      PRIORITIES.has(input.priority),
      "INVALID_REQUIREMENT",
      "Requirement priority is invalid.",
      { priority: input.priority },
    );
    assertDomain(
      SOURCES.has(input.source),
      "INVALID_REQUIREMENT",
      "Requirement source is invalid.",
      { source: input.source },
    );
    return Object.freeze({
      id: RequirementId.parse(input.id),
      statement: input.statement,
      priority: input.priority,
      source: input.source,
    });
  },
});
