import { describe, expect, it } from "vitest";
import { adapterRpcMessageSchema, adapterRpcRequestSchema } from "../src/adapter-rpc.schemas.js";
import {
  ADAPTER_PROTOCOL_VERSION_1_1,
  adapterInitializeV1_1RequestSchema,
  adapterRpcV1_1MessageSchema,
  adapterRpcV1_1RequestSchema,
  assertAdapterProtocolVersionSupported,
  isAdapterProtocolVersionSupported,
  negotiateAdapterProtocolVersion,
  SUPPORTED_ADAPTER_PROTOCOL_VERSIONS,
  toolInvokeScopedV1_1RequestSchema,
  toolInvokeScopedV1_1ResultSchema,
} from "../src/adapter-rpc-v1_1.schemas.js";
import { ADAPTER_PROTOCOL_VERSION } from "../src/common.schemas.js";

const budget = {
  maxWallClockMs: 60_000,
  maxModelInvocations: 1,
  maxToolInvocations: 4,
  maxRepairRounds: 0,
  maxConcurrentWorkers: 1,
} as const;

const v1InitializeRequest = {
  jsonrpc: "2.0",
  id: "rpc:1",
  method: "adapter.initialize",
  params: {
    protocolVersion: "1.0.0",
    adapterId: "adapter:local",
    runtimeId: "runtime:1",
    capabilities: ["tool"],
  },
} as const;

const v1ToolInvokeRequest = {
  jsonrpc: "2.0",
  id: "rpc:2",
  method: "tool.invoke",
  params: {
    invocationId: "invocation:1",
    jobId: "job:1",
    toolId: "tool:filesystem",
    operation: "read",
    inputArtifactIds: [],
    parameters: { path: "src/index.ts" },
    expectedOutputs: ["stdout"],
    resourceBudget: budget,
  },
} as const;

const v1_1ScopedToolRequest = {
  jsonrpc: "2.0",
  id: "rpc:3",
  method: "tool.invoke_scoped",
  params: {
    invocationId: "invocation:2",
    jobId: "job:1",
    taskId: "task:root",
    workspaceId: "workspace-1",
    sandboxId: "sandbox:1",
    toolId: "tool:filesystem",
    operation: "code.inspect",
    inputArtifactIds: [],
    parameters: { path: "src/index.ts" },
    expectedOutputs: ["stdout"],
    resourceBudget: budget,
  },
} as const;

describe("adapter protocol 1.0 is preserved exactly", () => {
  it("keeps the constant, the closed v1.0 method set, and v1.0 parse behavior unchanged", () => {
    expect(ADAPTER_PROTOCOL_VERSION).toBe("1.0.0");
    expect(adapterRpcRequestSchema.options).toHaveLength(11);
    expect(adapterRpcRequestSchema.parse(v1InitializeRequest)).toEqual(v1InitializeRequest);
    expect(adapterRpcRequestSchema.parse(v1ToolInvokeRequest)).toEqual(v1ToolInvokeRequest);
    expect(adapterRpcMessageSchema.parse(v1ToolInvokeRequest)).toEqual(v1ToolInvokeRequest);
  });

  it("rejects every 1.1-only method, version, and field at the v1.0 parser", () => {
    expect(adapterRpcRequestSchema.safeParse(v1_1ScopedToolRequest).success).toBe(false);
    expect(adapterRpcMessageSchema.safeParse(v1_1ScopedToolRequest).success).toBe(false);
    expect(
      adapterRpcRequestSchema.safeParse({
        ...v1InitializeRequest,
        params: { ...v1InitializeRequest.params, protocolVersion: ADAPTER_PROTOCOL_VERSION_1_1 },
      }).success,
    ).toBe(false);
    expect(
      adapterRpcRequestSchema.safeParse({
        ...v1ToolInvokeRequest,
        params: { ...v1ToolInvokeRequest.params, taskId: "task:root", sandboxId: "sandbox:1" },
      }).success,
    ).toBe(false);
  });
});

describe("adapter protocol 1.1 stands beside 1.0", () => {
  it("declares its own version identity and supported-version set", () => {
    expect(ADAPTER_PROTOCOL_VERSION_1_1).toBe("1.1.0");
    expect(ADAPTER_PROTOCOL_VERSION_1_1).not.toBe(ADAPTER_PROTOCOL_VERSION);
    expect([...SUPPORTED_ADAPTER_PROTOCOL_VERSIONS]).toEqual(["1.1.0", "1.0.0"]);
  });

  it("carries task, workspace, sandbox, and semantic-operation scope", () => {
    const parsed = toolInvokeScopedV1_1RequestSchema.parse(v1_1ScopedToolRequest);
    expect(parsed.params.taskId).toBe("task:root");
    expect(parsed.params.workspaceId).toBe("workspace-1");
    expect(parsed.params.sandboxId).toBe("sandbox:1");
    expect(parsed.params.operation).toBe("code.inspect");
    expect(adapterRpcV1_1RequestSchema.parse(v1_1ScopedToolRequest)).toEqual(v1_1ScopedToolRequest);
    expect(adapterRpcV1_1MessageSchema.parse(v1_1ScopedToolRequest)).toEqual(v1_1ScopedToolRequest);
  });

  it("negotiates 1.1 initialization only under the 1.1 version literal", () => {
    const request = {
      ...v1InitializeRequest,
      params: { ...v1InitializeRequest.params, protocolVersion: ADAPTER_PROTOCOL_VERSION_1_1 },
    };
    expect(adapterInitializeV1_1RequestSchema.parse(request).params.protocolVersion).toBe("1.1.0");
    expect(adapterInitializeV1_1RequestSchema.safeParse(v1InitializeRequest).success).toBe(false);
    expect(adapterRpcV1_1RequestSchema.safeParse(v1ToolInvokeRequest).success).toBe(false);
  });

  it("has no provider extension bag on any 1.1 object", () => {
    expect(
      toolInvokeScopedV1_1RequestSchema.safeParse({
        ...v1_1ScopedToolRequest,
        params: { ...v1_1ScopedToolRequest.params, ollamaOptions: { numGpu: 99 } },
      }).success,
    ).toBe(false);
    expect(
      adapterInitializeV1_1RequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "rpc:4",
        method: "adapter.initialize",
        params: {
          protocolVersion: ADAPTER_PROTOCOL_VERSION_1_1,
          adapterId: "adapter:local",
          runtimeId: "runtime:1",
          capabilities: ["tool"],
          vendorExtensions: { anything: true },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps the internal unknown effect state off the 1.1 wire result", () => {
    const result = {
      invocationId: "invocation:2",
      status: "completed",
      outputArtifactIds: [],
      logArtifactIds: [],
      metadata: {},
    } as const;
    expect(toolInvokeScopedV1_1ResultSchema.parse(result).status).toBe("completed");
    expect(
      toolInvokeScopedV1_1ResultSchema.safeParse({ ...result, status: "unknown" }).success,
    ).toBe(false);
  });
});

describe("adapter protocol version negotiation", () => {
  it("selects the highest mutually supported exact version", () => {
    expect(negotiateAdapterProtocolVersion(["1.0.0", "1.1.0"])).toBe("1.1.0");
    expect(negotiateAdapterProtocolVersion(["1.1.0"])).toBe("1.1.0");
    expect(negotiateAdapterProtocolVersion(["1.0.0"])).toBe("1.0.0");
  });

  it("rejects unsupported versions instead of coercing them", () => {
    for (const offered of [
      [],
      ["1.1"],
      ["1.1.1"],
      ["1.1.0-rc.1"],
      ["1.0.1"],
      ["2.0.0"],
      ["0.9.0"],
    ]) {
      expect(() => negotiateAdapterProtocolVersion(offered)).toThrow(/Unsupported|no mutually/iu);
    }
    expect(isAdapterProtocolVersionSupported("1.1.0")).toBe(true);
    expect(isAdapterProtocolVersionSupported("1.0.0")).toBe(true);
    for (const version of ["1.1", "1.1.1", "1.1.0-rc.1", "1.0.1", "2.0.0"]) {
      expect(isAdapterProtocolVersionSupported(version)).toBe(false);
      expect(() => assertAdapterProtocolVersionSupported(version)).toThrow();
    }
  });
});
