import { describe, expect, it } from "vitest";
import { runtimeEventSchema } from "../src/runtime-events.schemas.js";

const base = {
  schemaVersion: "1.0.0",
  eventId: "event:1",
  sequence: 1,
  occurredAt: "2026-08-06T21:00:00.000Z",
  aggregateType: "job",
  aggregateId: "job:1",
  correlationId: "request:1",
  causationId: "event:0",
} as const;

describe("runtime event contracts", () => {
  it("parses a strict job status event", () => {
    const event = {
      ...base,
      type: "job.status_changed",
      payload: {
        jobId: "job:1",
        previousStatus: "queued",
        status: "running",
        stage: "solve",
        progress: 0.1,
      },
    } as const;
    expect(runtimeEventSchema.parse(event).type).toBe("job.status_changed");
    expect(
      runtimeEventSchema.safeParse({ ...event, payload: { ...event.payload, hidden: true } }).success,
    ).toBe(false);
  });

  it("rejects events whose aggregate envelope disagrees with the typed payload", () => {
    const event = {
      ...base,
      aggregateId: "job:other",
      type: "job.status_changed",
      payload: {
        jobId: "job:1",
        previousStatus: "queued",
        status: "running",
        stage: "solve",
        progress: 0.1,
      },
    } as const;
    expect(runtimeEventSchema.safeParse(event).success).toBe(false);
  });

  it("requires nonnegative monotonic-ready sequence numbers", () => {
    const event = {
      ...base,
      aggregateType: "evidence",
      aggregateId: "evidence:1",
      type: "evidence.recorded",
      payload: {
        evidenceId: "evidence:1",
        subjectType: "candidate",
        subjectId: "candidate:1",
        status: "passed",
      },
    } as const;
    expect(runtimeEventSchema.parse(event).sequence).toBe(1);
    expect(runtimeEventSchema.safeParse({ ...event, sequence: -1 }).success).toBe(false);
    expect(runtimeEventSchema.safeParse({ ...event, sequence: 1.5 }).success).toBe(false);
  });

  it("rejects unknown event types and unsupported versions", () => {
    const event = {
      ...base,
      type: "unknown.event",
      payload: {},
    } as const;
    expect(runtimeEventSchema.safeParse(event).success).toBe(false);
    expect(runtimeEventSchema.safeParse({ ...event, schemaVersion: "2.0.0" }).success).toBe(false);
  });
});
