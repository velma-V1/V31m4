import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ApplicationJsonValue,
  type ClockPort,
  createOperationContext,
  type OperationContext,
  type PortHealth,
} from "@v31m4/application";
import { SqlitePluginRegistry, SqliteRuntimeDatabase } from "@v31m4/infrastructure";
import {
  DepartmentHost,
  type DepartmentHostOptions,
  type DepartmentInstance,
  type DepartmentManifest,
} from "../src/index.js";

export const context: OperationContext = createOperationContext({
  requestId: "request-host",
  idempotencyKey: "idempotency-host",
  actor: { id: "operator", kind: "user", roles: ["operator"] },
  startedAt: "2026-08-09T12:00:00.000Z",
});

export const clock: ClockPort = {
  now: () => "2026-08-09T12:00:00.000Z",
  monotonicMilliseconds: () => 0,
  sleep: async () => undefined,
};

export function manifest(overrides: Partial<DepartmentManifest> = {}): DepartmentManifest {
  return {
    departmentId: "demo-department",
    displayName: "Demo Department",
    version: "1.0.0",
    hostApiVersion: "1.0.0",
    capabilities: ["demo.run"],
    requiredToolIds: [],
    optionalToolIds: [],
    requiredModelIds: [],
    permissions: ["workspace.write"],
    workspacePath: "departments/demo",
    ...overrides,
  };
}

export function grant(overrides: Partial<Parameters<DepartmentHost["install"]>[1]> = {}) {
  return {
    permissions: ["workspace.write"],
    availableToolIds: [],
    availableModelIds: [],
    ...overrides,
  };
}

/** A controllable in-process department instance for deterministic lifecycle/failure tests. */
export class FakeInstance implements DepartmentInstance {
  started = false;
  stopped = false;
  constructor(
    private readonly behavior: {
      startError?: Error;
      invokeError?: Error;
      healthError?: Error;
      healthStatus?: PortHealth["status"];
    } = {},
  ) {}
  async start(): Promise<void> {
    if (this.behavior.startError) throw this.behavior.startError;
    this.started = true;
  }
  async invoke(capabilityId: string, request: ApplicationJsonValue): Promise<ApplicationJsonValue> {
    if (this.behavior.invokeError) throw this.behavior.invokeError;
    return { capabilityId, echoed: request };
  }
  async health(): Promise<PortHealth> {
    if (this.behavior.healthError) throw this.behavior.healthError;
    return Object.freeze({
      status: this.behavior.healthStatus ?? "healthy",
      checkedAt: "2026-08-09T12:00:00.000Z",
      details: {},
    });
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
}

export interface TestHarness {
  readonly host: DepartmentHost;
  readonly db: SqliteRuntimeDatabase;
  readonly registry: SqlitePluginRegistry;
  readonly released: string[];
  readonly instances: FakeInstance[];
}

export function harness(
  options: {
    connect?: DepartmentHostOptions["connector"]["connect"];
    allocateError?: Error;
    releaseError?: Error;
    instance?: FakeInstance;
    db?: SqliteRuntimeDatabase;
  } = {},
): TestHarness {
  const db =
    options.db ??
    new SqliteRuntimeDatabase(join(mkdtempSync(join(tmpdir(), "v31m4-host-")), "state.db"));
  const registry = new SqlitePluginRegistry(db);
  const released: string[] = [];
  const instances: FakeInstance[] = [];
  const host = new DepartmentHost({
    registry,
    unitOfWork: db.unitOfWork,
    clock,
    connector: {
      connect:
        options.connect ??
        (async () => {
          const inst = options.instance ?? new FakeInstance();
          instances.push(inst);
          return inst;
        }),
    },
    workspaces: {
      allocate: async (departmentId, relativePath) => {
        if (options.allocateError) throw options.allocateError;
        return {
          path: `${relativePath}/${departmentId}`,
          release: async () => {
            if (options.releaseError) throw options.releaseError;
            released.push(departmentId);
          },
        };
      },
    },
  });
  return { host, db, registry, released, instances };
}
