import { assertDomain } from "../domain-errors.js";

export interface ResourceBudget {
  readonly maxWallClockMs: number;
  readonly maxModelInvocations: number;
  readonly maxToolInvocations: number;
  readonly maxRepairRounds: number;
  readonly maxConcurrentWorkers: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxRamBytes?: number;
  readonly maxVramBytes?: number;
}

function assertIntegerAtLeast(name: string, value: number, minimum: number): void {
  assertDomain(
    Number.isSafeInteger(value) && value >= minimum,
    "INVALID_RESOURCE_BUDGET",
    `${name} must be a safe integer greater than or equal to ${minimum}.`,
    { name, value, minimum },
  );
}

function validateOptionalPositiveInteger(name: string, value: number | undefined): void {
  if (value !== undefined) {
    assertIntegerAtLeast(name, value, 1);
  }
}

export const ResourceBudget = Object.freeze({
  create(input: ResourceBudget): ResourceBudget {
    assertIntegerAtLeast("maxWallClockMs", input.maxWallClockMs, 1);
    assertIntegerAtLeast("maxModelInvocations", input.maxModelInvocations, 0);
    assertIntegerAtLeast("maxToolInvocations", input.maxToolInvocations, 0);
    assertIntegerAtLeast("maxRepairRounds", input.maxRepairRounds, 0);
    assertIntegerAtLeast("maxConcurrentWorkers", input.maxConcurrentWorkers, 1);
    validateOptionalPositiveInteger("maxInputTokens", input.maxInputTokens);
    validateOptionalPositiveInteger("maxOutputTokens", input.maxOutputTokens);
    validateOptionalPositiveInteger("maxRamBytes", input.maxRamBytes);
    validateOptionalPositiveInteger("maxVramBytes", input.maxVramBytes);

    return Object.freeze({ ...input });
  },
});
