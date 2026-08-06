import { describe, expect, it } from "vitest";
import { avatarStateSchema } from "../src/avatar.schemas.js";
import { modelProfileSchema } from "../src/models.schemas.js";
import { pluginManifestContractSchema, workflowDefinitionSchema } from "../src/plugins.schemas.js";
import { practiceTaskSchema } from "../src/practice.schemas.js";
import { toolProfileSchema } from "../src/tools.schemas.js";

describe("capability endpoint contracts", () => {
  it("keeps model profiles provider-neutral and strict", () => {
    const profile = {
      modelId: "model:qwen",
      adapterId: "adapter:ollama",
      displayName: "Primary Qwen",
      status: "available",
      local: true,
      contextLimit: 32_768,
      measuredCapabilities: [],
      supportedModalities: ["text"],
    } as const;
    expect(modelProfileSchema.parse(profile).local).toBe(true);
    expect(modelProfileSchema.safeParse({ ...profile, providerRaw: { id: 1 } }).success).toBe(false);
  });

  it("requires unique tool operations and prefers declared automation methods", () => {
    const profile = {
      toolId: "tool:blender",
      adapterId: "adapter:blender",
      displayName: "Blender",
      status: "available",
      operations: ["render", "inspect"],
      installedVersion: "4.5.0",
      automationMethod: "python",
    } as const;
    expect(toolProfileSchema.parse(profile).operations).toEqual(["render", "inspect"]);
    expect(
      toolProfileSchema.safeParse({ ...profile, operations: ["render", "render"] }).success,
    ).toBe(false);
  });

  it("validates acyclic workflows and rejects missing dependencies", () => {
    const workflow = {
      schemaVersion: "1.0.0",
      workflowId: "workflow:video",
      version: "1.0.0",
      displayName: "Video Production",
      inputSchemaRef: "v31m4://schemas/video-input/1.0.0",
      outputSchemaRef: "v31m4://schemas/video-output/1.0.0",
      stages: [
        {
          id: "preview",
          capabilityId: "capability:preview",
          dependsOn: [],
          timeoutMs: 60_000,
          maxAttempts: 1,
          checkpoint: true,
        },
        {
          id: "verify",
          capabilityId: "capability:verify",
          dependsOn: ["preview"],
          timeoutMs: 60_000,
          maxAttempts: 1,
          checkpoint: true,
        },
      ],
    } as const;
    expect(workflowDefinitionSchema.parse(workflow).stages).toHaveLength(2);
    expect(
      workflowDefinitionSchema.safeParse({
        ...workflow,
        stages: [{ ...workflow.stages[0], dependsOn: ["missing"] }],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...workflow,
        stages: [
          { ...workflow.stages[0], dependsOn: ["verify"] },
          { ...workflow.stages[1], dependsOn: ["preview"] },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires plugin capability and tool declarations to be unique", () => {
    const manifest = {
      schemaVersion: "1.0.0",
      pluginId: "plugin:video",
      displayName: "Video Production",
      version: "1.0.0",
      minimumRuntimeVersion: "1.0.0",
      entrypoint: "dist/index.js",
      capabilities: ["capability:video"],
      requiredToolIds: ["tool:ffmpeg"],
      optionalToolIds: ["tool:topaz"],
      workflowIds: ["workflow:video"],
      verifierIds: ["verifier:video"],
      permissions: {
        filesystem: ["project_read", "working_copy_write"],
        network: false,
        process: ["ffmpeg"],
      },
    } as const;
    expect(pluginManifestContractSchema.parse(manifest).pluginId).toBe("plugin:video");
    expect(
      pluginManifestContractSchema.safeParse({
        ...manifest,
        requiredToolIds: ["tool:ffmpeg"],
        optionalToolIds: ["tool:ffmpeg"],
      }).success,
    ).toBe(false);
  });

  it("requires practice workspaces to remain project-relative and evidence-backed when quarantined", () => {
    const practice = {
      id: "practice:1",
      capabilityId: "capability:contracts",
      targetDifficulty: 3,
      status: "quarantined",
      isolatedWorkspacePath: "practice/task-1",
      resourceBudget: {
        maxWallClockMs: 60_000,
        maxModelInvocations: 1,
        maxToolInvocations: 1,
        maxRepairRounds: 0,
        maxConcurrentWorkers: 1,
      },
      traceArtifactIds: ["artifact:trace"],
      evidenceIds: ["evidence:practice"],
    } as const;
    expect(practiceTaskSchema.parse(practice).status).toBe("quarantined");
    expect(
      practiceTaskSchema.safeParse({ ...practice, isolatedWorkspacePath: "../production" }).success,
    ).toBe(false);
    expect(practiceTaskSchema.safeParse({ ...practice, evidenceIds: [] }).success).toBe(false);
  });

  it("rejects equipped avatar items that were never unlocked", () => {
    const state = {
      avatarId: "avatar:main",
      unlockedItemIds: ["avatar-item:badge"],
      equippedItemIds: ["avatar-item:badge"],
      evolutionStage: 1,
      unlockHistory: [
        {
          itemId: "avatar-item:badge",
          achievementRuleId: "achievement:contracts",
          evidenceIds: ["evidence:1"],
          unlockedAt: "2026-08-06T21:00:00.000Z",
          permanent: true,
        },
      ],
    } as const;
    expect(avatarStateSchema.parse(state).equippedItemIds).toEqual(["avatar-item:badge"]);
    expect(
      avatarStateSchema.safeParse({
        ...state,
        equippedItemIds: ["avatar-item:unearned"],
      }).success,
    ).toBe(false);
  });
});
