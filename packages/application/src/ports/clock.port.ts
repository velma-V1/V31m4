import type { CancellationSignal } from "../operation-context.js";

export interface ClockPort {
  now(): string;
  monotonicMilliseconds(): number;
  sleep(milliseconds: number, signal?: CancellationSignal): Promise<void>;
}
