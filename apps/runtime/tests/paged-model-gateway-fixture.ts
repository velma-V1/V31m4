import type {
  ModelGatewayPort,
  ModelInvocationRequest,
  OperationContext,
  PortPageRequest,
} from "@v31m4/application";
import { AdapterId, type ModelId, ModelProfile } from "@v31m4/domain";

const PAGE_BOUNDARY = 500;
const adapterId = AdapterId.parse("paged-test-adapter");

export const AFTER_FIRST_PAGE_MODEL_ID = "paged-model-500" as ModelId;

export function paginatedModelProfiles() {
  return Object.freeze(
    Array.from({ length: 503 }, (_, index) =>
      ModelProfile.create({
        modelId: `paged-model-${String(index).padStart(3, "0")}` as ModelId,
        adapterId,
        displayName: `Paged model ${index}`,
        status: index < PAGE_BOUNDARY ? "unavailable" : "available",
        local: true,
        supportedModalities: index < PAGE_BOUNDARY ? ["image"] : ["text"],
      }),
    ),
  );
}

export class PagedModelGateway implements ModelGatewayPort {
  readonly #profiles = paginatedModelProfiles();

  constructor(private readonly delegate: ModelGatewayPort) {}

  async list(request: PortPageRequest) {
    const start = request.cursor === undefined ? 0 : request.cursor === "after-500" ? 500 : -1;
    if (start < 0) throw new Error("Unexpected provider cursor.");
    const end = Math.min(
      start + request.limit,
      start === 0 ? PAGE_BOUNDARY : this.#profiles.length,
    );
    return Object.freeze({
      items: this.#profiles.slice(start, end),
      total: this.#profiles.length,
      ...(end < this.#profiles.length ? { nextCursor: "after-500" } : {}),
    });
  }

  async get(modelId: ModelId) {
    return this.#profiles.find((profile) => profile.modelId === modelId) ?? null;
  }

  invoke(request: ModelInvocationRequest, context: OperationContext) {
    return this.delegate.invoke(request, context);
  }

  cancel(invocationId: string, context: OperationContext) {
    return this.delegate.cancel(invocationId, context);
  }

  health(modelId: ModelId, context: OperationContext) {
    return this.delegate.health(modelId, context);
  }
}
