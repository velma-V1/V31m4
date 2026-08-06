import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { pluginManifestContractSchema, workflowDefinitionSchema } from "../src/plugins.schemas.js";

const schemaNames = [
  "adapter-manifest.schema.json",
  "plugin-manifest.schema.json",
  "workflow.schema.json",
  "evidence-record.schema.json",
  "training-packet.schema.json",
  "capability-package.schema.json",
  "achievement-rule.schema.json",
] as const;

const schemaRootCandidates = [
  fileURLToPath(new URL("../../../schemas/", import.meta.url)),
  resolve(process.cwd(), "schemas"),
  resolve(process.cwd(), "../../schemas"),
];
const schemaRoot = schemaRootCandidates.find((candidate) => existsSync(candidate));
if (schemaRoot === undefined) {
  throw new Error("Unable to locate the repository schemas directory.");
}
const requiredSchemaRoot: string = schemaRoot;

function loadSchema(name: (typeof schemaNames)[number]): Record<string, unknown> {
  const path = resolve(requiredSchemaRoot, name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv;
}

describe("root JSON Schemas", () => {
  it("compiles every schema under draft 2020-12", () => {
    const ajv = createAjv();
    for (const name of schemaNames) {
      const schema = loadSchema(name);
      expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(typeof schema["$id"]).toBe("string");
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  });

  it("validates strict adapter and plugin manifests", () => {
    const ajv = createAjv();
    const adapterValidate = ajv.compile(loadSchema("adapter-manifest.schema.json"));
    const pluginValidate = ajv.compile(loadSchema("plugin-manifest.schema.json"));

    const adapter = {
      schemaVersion: "1.0.0",
      protocolVersion: "1.0.0",
      adapterId: "adapter:ollama",
      kind: "model",
      displayName: "Ollama",
      version: "1.0.0",
      transport: "stdio",
      entrypoint: { command: "node", args: ["dist/index.js"] },
      capabilities: ["model.invoke"],
      permissions: {
        filesystem: [],
        network: ["http://127.0.0.1:11434"],
        process: [],
        secretNames: [],
      },
      health: { timeoutMs: 5000, intervalMs: 30000 },
    };
    expect(adapterValidate(adapter)).toBe(true);
    expect(adapterValidate({ ...adapter, hidden: true })).toBe(false);

    const plugin = {
      schemaVersion: "1.0.0",
      pluginId: "plugin:video",
      displayName: "Video",
      version: "1.0.0",
      minimumRuntimeVersion: "1.0.0",
      entrypoint: "dist/index.js",
      capabilities: ["capability:video"],
      requiredToolIds: ["tool:ffmpeg"],
      optionalToolIds: [],
      workflowIds: ["workflow:video"],
      verifierIds: ["verifier:video"],
      permissions: {
        filesystem: ["project_read", "working_copy_write"],
        network: false,
        process: ["ffmpeg"],
      },
    };
    expect(pluginValidate(plugin)).toBe(true);
    expect(pluginValidate({ ...plugin, capabilities: [] })).toBe(false);
  });

  it("keeps TypeScript and JSON manifest contracts aligned", () => {
    const ajv = createAjv();
    const pluginValidate = ajv.compile(loadSchema("plugin-manifest.schema.json"));
    const workflowValidate = ajv.compile(loadSchema("workflow.schema.json"));

    const plugin = {
      schemaVersion: "1.0.0",
      pluginId: "plugin:video",
      displayName: "Video",
      version: "1.0.0",
      minimumRuntimeVersion: "1.0.0",
      entrypoint: "dist/index.js",
      capabilities: ["capability:video"],
      requiredToolIds: ["tool:ffmpeg"],
      optionalToolIds: [],
      workflowIds: ["workflow:video"],
      verifierIds: ["verifier:video"],
      permissions: { filesystem: ["project_read"], network: false, process: ["ffmpeg"] },
    } as const;
    expect(pluginManifestContractSchema.safeParse(plugin).success).toBe(pluginValidate(plugin));
    const missingRuntimeVersion = { ...plugin, minimumRuntimeVersion: undefined };
    expect(pluginManifestContractSchema.safeParse(missingRuntimeVersion).success).toBe(
      pluginValidate(missingRuntimeVersion),
    );

    const workflow = {
      schemaVersion: "1.0.0",
      workflowId: "workflow:video",
      version: "1.0.0",
      displayName: "Video",
      inputSchemaRef: "v31m4://schemas/video-input/1.0.0",
      outputSchemaRef: "v31m4://schemas/video-output/1.0.0",
      stages: [
        {
          id: "render",
          capabilityId: "capability:render",
          dependsOn: [],
          timeoutMs: 60000,
          maxAttempts: 1,
          checkpoint: true,
        },
      ],
    } as const;
    expect(workflowDefinitionSchema.safeParse(workflow).success).toBe(workflowValidate(workflow));
  });

  it("rejects incomplete evidence and training packets", () => {
    const ajv = createAjv();
    const evidenceValidate = ajv.compile(loadSchema("evidence-record.schema.json"));
    const packetValidate = ajv.compile(loadSchema("training-packet.schema.json"));

    const evidence = {
      schemaVersion: "1.0.0",
      id: "evidence:1",
      projectId: "project:1",
      kind: "unit_test",
      subjectType: "schema",
      subjectId: "contracts",
      status: "passed",
      summary: "Passed.",
      artifactIds: ["artifact:1"],
      verifierId: "verifier:1",
      verifierVersion: "1.0.0",
      createdAt: "2026-08-06T21:00:00.000Z",
      immutable: true,
    };
    expect(evidenceValidate(evidence)).toBe(true);
    expect(evidenceValidate({ ...evidence, artifactIds: [] })).toBe(false);

    const packet = {
      schemaVersion: "1.0.0",
      id: "training:1",
      missionId: "mission:1",
      status: "quarantined",
      taskArtifactId: "artifact:task",
      contextArtifactIds: ["artifact:context"],
      originalCandidateIds: ["candidate:1"],
      preferredCandidateId: "candidate:1",
      rejectedCandidateIds: [],
      issueIds: [],
      repairIds: [],
      verificationEvidenceIds: ["evidence:1"],
      trainingViews: [{ kind: "sft", artifactId: "artifact:view" }],
      provenanceHash: "a".repeat(64),
      evaluationLeakageChecked: false,
    };
    expect(packetValidate(packet)).toBe(true);
    expect(packetValidate({ ...packet, verificationEvidenceIds: [] })).toBe(false);
  });
});
