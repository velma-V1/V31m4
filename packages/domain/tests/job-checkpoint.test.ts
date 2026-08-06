import { describe, expect, it } from "vitest";
import {
  Checkpoint,
  DomainError,
  Job,
} from "../src/index.js";

const T0 = "2026-08-06T20:00:00.000Z";
const T1 = "2026-08-06T20:01:00.000Z";
const T2 = "2026-08-06T20:02:00.000Z";
const T3 = "2026-08-06T20:03:00.000Z";
const HASH = "a".repeat(64);

describe("job and checkpoint domain", () => {
  it("executes the durable job lifecycle and emits immutable events", () => {
    const created = Job.create({
      id: "job-1",
      projectId: "project-1",
      missionId: "mission-1",
      workflowId: "domain-layer",
      eventId: "event-1",
      occurredAt: T0,
    });
    const queued = Job.queue(created.job, { eventId: "event-2", occurredAt: T1 });
    const running = Job.start(queued.job, {
      eventId: "event-3",
      occurredAt: T2,
      stage: "implement",
    });
    const completed = Job.complete(running.job, { eventId: "event-4", occurredAt: T3 });

    expect(created.job.status).toBe("created");
    expect(completed.job.status).toBe("completed");
    expect(completed.job.progress).toBe(1);
    expect(completed.event.type).toBe("job.completed");
    expect(Object.isFrozen(completed.event.payload)).toBe(true);
  });


  it("resumes only paused jobs and emits a resumed event", () => {
    const created = Job.create({
      id: "job-2",
      projectId: "project-1",
      missionId: "mission-1",
      workflowId: "domain-layer",
      eventId: "event-10",
      occurredAt: T0,
    });
    const queued = Job.queue(created.job, { eventId: "event-11", occurredAt: T1 });
    const running = Job.start(queued.job, { eventId: "event-12", occurredAt: T2 });
    const paused = Job.pause(running.job, { eventId: "event-13", occurredAt: T3 });
    const resumed = Job.resume(paused.job, {
      eventId: "event-14",
      occurredAt: "2026-08-06T20:04:00.000Z",
    });

    expect(resumed.job.status).toBe("running");
    expect(resumed.event.type).toBe("job.resumed");
  });

  it("preserves the last checkpoint identifier during emergency stop", () => {
    const created = Job.create({
      id: "job-1",
      projectId: "project-1",
      missionId: "mission-1",
      workflowId: "domain-layer",
      eventId: "event-1",
      occurredAt: T0,
    });
    const queued = Job.queue(created.job, { eventId: "event-2", occurredAt: T1 });
    const running = Job.start(queued.job, { eventId: "event-3", occurredAt: T2 });
    const checkpointing = Job.beginCheckpoint(running.job, {
      eventId: "event-4",
      occurredAt: T3,
    });
    const checkpointed = Job.recordCheckpoint(checkpointing.job, {
      eventId: "event-5",
      occurredAt: "2026-08-06T20:04:00.000Z",
      checkpointId: "checkpoint-1",
    });
    const stopped = Job.beginEmergencyStop(checkpointed.job, {
      eventId: "event-6",
      occurredAt: "2026-08-06T20:05:00.000Z",
    });

    expect(stopped.job.latestCheckpointId).toBe("checkpoint-1");
  });

  it("rejects illegal job transitions", () => {
    const created = Job.create({
      id: "job-1",
      projectId: "project-1",
      missionId: "mission-1",
      workflowId: "domain-layer",
      eventId: "event-1",
      occurredAt: T0,
    });

    expect(() =>
      Job.complete(created.job, { eventId: "event-2", occurredAt: T1 }),
    ).toThrowError(DomainError);
  });

  it("requires evidence for verified checkpoints", () => {
    expect(() =>
      Checkpoint.create({
        id: "checkpoint-1",
        jobId: "job-1",
        stage: "domain",
        stateArtifactId: "artifact-state",
        evidenceIds: [],
        contentHash: HASH,
        verified: true,
        createdAt: T0,
      }),
    ).toThrowError(DomainError);

    const checkpoint = Checkpoint.create({
      id: "checkpoint-1",
      jobId: "job-1",
      stage: "domain",
      stateArtifactId: "artifact-state",
      evidenceIds: ["evidence-1"],
      contentHash: HASH,
      verified: true,
      createdAt: T0,
    });
    expect(checkpoint.verified).toBe(true);
  });
});
