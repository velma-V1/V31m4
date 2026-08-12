import {
  createOperationContext,
  type ModelGatewayPort,
  type ModelInvocationRequest,
  type OperationContext,
  type PortHealth,
  type PortPage,
} from "@v31m4/application";
import { AdapterId, type ModelId, ModelProfile } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { collectCompleteModelCatalog } from "../src/model-catalog.js";

const context = createOperationContext({
  requestId: "model-catalog-request",
  correlationId: "model-catalog-correlation",
  idempotencyKey: "model-catalog-idempotency",
  actor: { id: "tester", kind: "user", roles: ["operator"] },
  startedAt: new Date(0).toISOString(),
});

function profile(index: number) {
  return ModelProfile.create({
    modelId: `catalog-model-${index}` as ModelId,
    adapterId: AdapterId.parse("catalog-test-adapter"),
    displayName: `Catalog model ${index}`,
    status: "available",
    local: true,
    supportedModalities: ["text"],
  });
}

function gateway(
  load: (cursor: string | undefined) => PortPage<ReturnType<typeof profile>>,
): ModelGatewayPort {
  return {
    async list(request) {
      return load(request.cursor);
    },
    async get() {
      return null;
    },
    async invoke(_request: ModelInvocationRequest, _context: OperationContext) {
      throw new Error("not used");
    },
    async cancel() {},
    async health(): Promise<PortHealth> {
      return { status: "healthy", checkedAt: new Date(0).toISOString(), details: {} };
    },
  };
}

describe("complete model catalog pagination", () => {
  it("fails closed when an opaque provider cursor cycles", async () => {
    let page = 0;
    await expect(
      collectCompleteModelCatalog(
        gateway(() => {
          page += 1;
          return { items: [profile(page)], nextCursor: "provider-cycle" };
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  it("fails closed when a provider total changes between pages", async () => {
    await expect(
      collectCompleteModelCatalog(
        gateway((cursor) =>
          cursor === undefined
            ? { items: [profile(1)], total: 2, nextCursor: "provider-next" }
            : { items: [profile(2)], total: 3 },
        ),
        context,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  });

  it("fails closed when a provider never terminates within the page bound", async () => {
    let page = 0;
    await expect(
      collectCompleteModelCatalog(
        gateway(() => {
          page += 1;
          return { items: [profile(page)], nextCursor: `provider-${page}` };
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: "RESOURCE_EXHAUSTED" });
    expect(page).toBe(1_000);
  });
});
