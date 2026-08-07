import { ArtifactId, ContentHash, EvidenceId, JobId, MissionId, ProjectId } from "@v31m4/domain";
import { describe, expect, it } from "vitest";
import { checkpointJob, resumeJob, startJob, stopJob } from "../../src/index.js";
import { budget, context, Harness } from "./fixtures.js";

function startCommand() {
  return {
    jobId: "job-1",
    projectId: ProjectId.parse("project-1"),
    missionId: MissionId.parse("mission-1"),
    workflowId: "workflow-1",
    input: {},
    resourceBudget: budget(),
    createdEventId: "event-created",
    queuedEventId: "event-queued",
    startedEventId: "event-started",
    failureEventId: "event-failed",
    auditId: "audit-job-1",
  };
}

describe("durable job use cases", () => {
  it("starts only after commit, checkpoints, and enters finish-stop", async () => {
    const harness = new Harness();
    const started = await startJob(
      {
        unitOfWork: harness.unitOfWork,
        jobs: harness.jobRepository,
        events: harness.eventBus,
        kernel: harness.kernel,
        audit: harness.audit,
        clock: harness.clock,
      },
      startCommand(),
      context,
    );
    expect(started.value.status).toBe("running");
    expect(harness.jobs.get("job-1")?.value.status).toBe("running");
    const checkpoint = await checkpointJob(
      {
        unitOfWork: harness.unitOfWork,
        jobs: harness.jobRepository,
        events: harness.eventBus,
        kernel: harness.kernel,
        clock: harness.clock,
      },
      {
        jobId: JobId.parse("job-1"),
        stage: "solve",
        stateArtifactId: ArtifactId.parse("state-1"),
        evidenceIds: [EvidenceId.parse("evidence-checkpoint")],
        contentHash: ContentHash.parse("a".repeat(64)),
        verified: true,
        beginEventId: "event-checkpointing",
        recordedEventId: "event-checkpointed",
        failureEventId: "event-checkpoint-failed",
      },
      context,
    );
    expect(checkpoint.value.verified).toBe(true);
    expect(harness.jobs.get("job-1")?.value.latestCheckpointId).toBe(checkpoint.value.id);
    const stopping = await stopJob(
      {
        unitOfWork: harness.unitOfWork,
        jobs: harness.jobRepository,
        events: harness.eventBus,
        kernel: harness.kernel,
        clock: harness.clock,
      },
      {
        jobId: JobId.parse("job-1"),
        mode: "finish_and_stop",
        stopEventId: "event-stop",
        failureEventId: "event-stop-failed",
      },
      context,
    );
    expect(stopping.value.status).toBe("finish_stopping");
  });

  it("records a failed job when the kernel cannot start", async () => {
    const harness = new Harness();
    harness.kernelFailure = new Error("kernel unavailable");
    await expect(
      startJob(
        {
          unitOfWork: harness.unitOfWork,
          jobs: harness.jobRepository,
          events: harness.eventBus,
          kernel: harness.kernel,
          audit: harness.audit,
          clock: harness.clock,
        },
        startCommand(),
        context,
      ),
    ).rejects.toThrow();
    expect(harness.jobs.get("job-1")?.value.status).toBe("failed");
    expect(harness.unitOfWork.rollbacks).toBe(0);
  });

  it("rejects finish-stop until a verified checkpoint exists", async () => {
    const harness = new Harness();
    await startJob(
      {
        unitOfWork: harness.unitOfWork,
        jobs: harness.jobRepository,
        events: harness.eventBus,
        kernel: harness.kernel,
        audit: harness.audit,
        clock: harness.clock,
      },
      startCommand(),
      context,
    );
    await expect(
      stopJob(
        {
          unitOfWork: harness.unitOfWork,
          jobs: harness.jobRepository,
          events: harness.eventBus,
          kernel: harness.kernel,
          clock: harness.clock,
        },
        {
          jobId: JobId.parse("job-1"),
          mode: "finish_and_stop",
          stopEventId: "event-stop",
          failureEventId: "event-stop-failed",
        },
        context,
      ),
    ).rejects.toThrow("verified checkpoint");
    expect(harness.jobs.get("job-1")?.value.status).toBe("running");
  });

  it("rejects an unverified explicit checkpoint during resume", async () => {
    const harness = new Harness();
    const started = await startJob(
      {
        unitOfWork: harness.unitOfWork,
        jobs: harness.jobRepository,
        events: harness.eventBus,
        kernel: harness.kernel,
        audit: harness.audit,
        clock: harness.clock,
      },
      startCommand(),
      context,
    );
    const checkpoint = await checkpointJob(
      {
        unitOfWork: harness.unitOfWork,
        jobs: harness.jobRepository,
        events: harness.eventBus,
        kernel: harness.kernel,
        clock: harness.clock,
      },
      {
        jobId: started.value.id,
        stage: "solve",
        stateArtifactId: ArtifactId.parse("state-1"),
        evidenceIds: [],
        contentHash: ContentHash.parse("a".repeat(64)),
        verified: false,
        beginEventId: "event-checkpointing",
        recordedEventId: "event-checkpointed",
        failureEventId: "event-checkpoint-failed",
      },
      context,
    );
    await expect(
      resumeJob(
        {
          unitOfWork: harness.unitOfWork,
          jobs: harness.jobRepository,
          events: harness.eventBus,
          kernel: harness.kernel,
          clock: harness.clock,
        },
        {
          jobId: started.value.id,
          checkpointId: checkpoint.value.id,
          resumedEventId: "event-resumed",
          failureEventId: "event-resume-failed",
        },
        context,
      ),
    ).rejects.toThrow("verified checkpoint");
  });
});
