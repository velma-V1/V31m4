import { describe, expect, it } from "vitest";
import { createDomainEvent } from "../src/domain-events.js";

describe("createDomainEvent", () => {
  it("creates an immutable event with recursively copied and frozen payload data", () => {
    const payload = {
      projectId: "project-1",
      state: {
        stage: "created",
        attempts: [1, 2],
      },
    };
    const metadata = { correlationId: "mission-1" };

    const event = createDomainEvent({
      id: "event-1",
      type: "project.created",
      aggregateType: "project",
      aggregateId: "project-1",
      occurredAt: "2026-08-06T20:00:00.000Z",
      payload,
      metadata,
    });

    payload.state.stage = "changed";
    payload.state.attempts.push(3);
    metadata.correlationId = "changed";

    expect(event.type).toBe("project.created");
    expect(event.payload).toEqual({
      projectId: "project-1",
      state: {
        stage: "created",
        attempts: [1, 2],
      },
    });
    expect(event.metadata).toEqual({ correlationId: "mission-1" });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    expect(Object.isFrozen(event.payload.state)).toBe(true);
    expect(Object.isFrozen(event.payload.state.attempts)).toBe(true);
    expect(Object.isFrozen(event.metadata)).toBe(true);
  });

  it.each([
    {
      type: "",
      aggregateType: "project",
      aggregateId: "p1",
      occurredAt: "2026-08-06T20:00:00.000Z",
    },
    {
      type: "Project.Created",
      aggregateType: "project",
      aggregateId: "p1",
      occurredAt: "2026-08-06T20:00:00.000Z",
    },
    {
      type: "created",
      aggregateType: "",
      aggregateId: "p1",
      occurredAt: "2026-08-06T20:00:00.000Z",
    },
    {
      type: "created",
      aggregateType: "project",
      aggregateId: "",
      occurredAt: "2026-08-06T20:00:00.000Z",
    },
    {
      type: "created",
      aggregateType: "project",
      aggregateId: "p1",
      occurredAt: "not-a-date",
    },
    {
      type: "created",
      aggregateType: "project",
      aggregateId: "p1",
      occurredAt: "2026-02-30T20:00:00.000Z",
    },
  ])("rejects invalid event fields %#", (invalid) => {
    expect(() =>
      createDomainEvent({
        id: "event-1",
        payload: {},
        ...invalid,
      }),
    ).toThrow();
  });

  it("rejects non-finite nested numbers", () => {
    expect(() =>
      createDomainEvent({
        id: "event-1",
        type: "project.measured",
        aggregateType: "project",
        aggregateId: "project-1",
        occurredAt: "2026-08-06T20:00:00.000Z",
        payload: { score: Number.NaN },
      }),
    ).toThrow();
  });
});
