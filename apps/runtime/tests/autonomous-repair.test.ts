import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootGeneralRuntime,
  cleanupGeneralFixtures,
  createGeneralMission,
  fakeOllama,
  GENERAL_TOKEN,
  generalCommand,
  generalRuntimes,
  startGeneralJob,
} from "./general-coding-fixture.js";

afterEach(cleanupGeneralFixtures);

describe("autonomous repair restart recovery", () => {
  it("reconciles an applied repair exactly once after a fresh runtime starts", async () => {
    const wrong = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "still broken";\n',
        },
      ],
    });
    const fixed = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "hello world";\n',
        },
      ],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-repair-restart-"));
    const endpoint = await fakeOllama([wrong, fixed]);
    const firstBase = await bootGeneralRuntime(dataRoot, endpoint, {
      interruptAfterRepairKernelEffect: true,
    });
    const setup = await createGeneralMission(firstBase, dataRoot, 1);
    const jobId = await startGeneralJob(firstBase, setup.missionId, "restart-repair-job");
    const interrupted = await generalCommand(firstBase, "job.execute", "restart-repair", {
      jobId,
    });
    expect(interrupted.status).toBe(503);

    const firstRuntime = generalRuntimes.shift();
    await firstRuntime?.shutdown();
    const secondBase = await bootGeneralRuntime(dataRoot, endpoint);
    const resumed = await generalCommand(secondBase, "job.execute", "restart-repair", { jobId });
    const body = (await resumed.json()) as { result?: unknown; error?: unknown };
    expect(resumed.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "completed" },
      candidate: { original: false },
      verification: { status: "passed" },
      decision: { decision: "champion" },
    });

    const candidates = await fetch(`${secondBase}/queries/candidate.list`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${GENERAL_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "restart-repair-candidates",
        projectId: setup.projectId,
        missionId: setup.missionId,
        pagination: { limit: 10 },
      }),
    });
    expect(await candidates.json()).toMatchObject({ result: { pagination: { total: 2 } } });
    expect(
      JSON.parse(
        readFileSync(
          join(dataRoot, `supervised/kernel-workspaces/${jobId}/kernel-state.json`),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "completed", applyCount: 2 });

    const retry = await generalCommand(secondBase, "job.execute", "restart-repair", { jobId });
    expect(retry.status).toBe(200);
  });

  it("rejects a repair manifest outside the declared path scope without applying it", async () => {
    const wrong = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "still broken";\n',
        },
      ],
    });
    const escaped = JSON.stringify({
      changes: [{ path: "README.md", operation: "update", content: "escaped\n" }],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-repair-scope-"));
    const base = await bootGeneralRuntime(dataRoot, await fakeOllama([wrong, escaped]));
    const setup = await createGeneralMission(base, dataRoot, 1);
    const jobId = await startGeneralJob(base, setup.missionId, "scope-repair-job");
    const response = await generalCommand(base, "job.execute", "scope-repair", { jobId });
    expect(response.status).toBe(502);
    expect(
      readFileSync(join(dataRoot, `supervised/kernel-workspaces/${jobId}/README.md`), "utf8"),
    ).toBe("unrelated content must remain unchanged\n");
  });
});
