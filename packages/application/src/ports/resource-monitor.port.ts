import type { Score } from "@v31m4/domain";
import type { ApplicationJsonObject } from "../application-json.js";
import type { OperationContext } from "../operation-context.js";
import type { PortListener, PortSubscription } from "../port-types.js";

export interface ResourceReading {
  readonly cpuUtilization: Score;
  readonly ramUsedBytes: number;
  readonly ramTotalBytes: number;
  readonly gpuUtilization?: Score;
  readonly vramUsedBytes?: number;
  readonly vramTotalBytes?: number;
  readonly cpuTemperatureCelsius?: number;
  readonly gpuTemperatureCelsius?: number;
  readonly storageFreeBytes: number;
  readonly idleForMs: number;
  readonly capturedAt: string;
  readonly details: ApplicationJsonObject;
}

export interface ResourceMonitorPort {
  read(context: OperationContext): Promise<ResourceReading>;
  watch(
    listener: PortListener<ResourceReading>,
    context: OperationContext,
  ): Promise<PortSubscription>;
}
