import { PracticeTask, ResourceBudget } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { practiceTaskSchema } from "../src/index.js";

const budget = ResourceBudget.create({ maxWallClockMs: 1_000, maxModelInvocations: 1, maxToolInvocations: 0, maxRepairRounds: 0, maxConcurrentWorkers: 1 });

describe("practice domain and contract parity", () => {
  it("requires the opaque workspace identity in both layers", () => {
    const running = PracticeTask.start(PracticeTask.create({ id: "practice-1", capabilityId: "capability-1", targetDifficulty: 0.4, workspaceId: "workspace-1", isolatedWorkspacePath: "workspaces/practice-1", resourceBudget: budget }));
    expect(practiceTaskSchema.parse(running).workspaceId).toBe("workspace-1");
    expect(() => practiceTaskSchema.parse({ ...running, workspaceId: undefined })).toThrow();
  });

  it("accepts a freshly running task before any trace artifact exists", () => {
    const running = PracticeTask.start(PracticeTask.create({ id: "practice-1", capabilityId: "capability-1", targetDifficulty: 0.4, workspaceId: "workspace-1", isolatedWorkspacePath: "workspaces/practice-1", resourceBudget: budget }));
    expect(() => practiceTaskSchema.parse(running)).not.toThrow();
  });
});
