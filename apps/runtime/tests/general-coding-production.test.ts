import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_SCHEMA_VERSION } from "@v31m4/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootGeneralRuntime as boot,
  cleanupGeneralFixtures,
  generalCommand as command,
  createGeneralMission as createMission,
  fakeOllama,
  generalRuntimes as runtimes,
  startGeneralJob,
  GENERAL_TOKEN as TOKEN,
} from "./general-coding-fixture.js";

afterEach(cleanupGeneralFixtures);

describe("general supervised coding production", () => {
  it("executes a real multi-file mission while preserving unrelated source", async () => {
    const manifest = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "hello world";\n',
        },
      ],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-production-"));
    const endpoint = await fakeOllama(manifest);
    const base = await boot(dataRoot, endpoint);
    const setup = await createMission(base, dataRoot);
    const jobId = await startGeneralJob(base, setup.missionId, "general-job");
    const result = await command(base, "job.execute", "general-execute", {
      jobId,
    });
    const body = (await result.json()) as {
      result?: { job: { status: string }; verification: { status: string }; receipt: unknown };
      error?: { code: string; message: string };
    };
    expect(result.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "completed" },
      verification: { status: "passed" },
    });
    expect(body.result?.receipt).not.toBeNull();
    const workspace = join(dataRoot, `supervised/kernel-workspaces/${jobId}`);
    expect(readFileSync(join(workspace, "src/greeting.mjs"), "utf8")).toContain("hello world");
    expect(readFileSync(join(workspace, "README.md"), "utf8")).toBe(
      "unrelated content must remain unchanged\n",
    );
    expect(readFileSync(join(workspace, "src/format.mjs"), "utf8")).toContain("formatGreeting");
    expect(readFileSync(join(setup.source, "src/greeting.mjs"), "utf8")).toContain("broken");
    const retry = await command(base, "job.execute", "general-execute", { jobId });
    expect(retry.status).toBe(200);

    const firstRuntime = runtimes.shift();
    await firstRuntime?.shutdown();
    const restartedBase = await boot(dataRoot, endpoint);
    const recovered = await fetch(`${restartedBase}/records/job/${jobId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ record: { value: { status: "completed" } } });
  });

  it("rejects an out-of-scope model change before any protected workspace effect", async () => {
    const manifest = JSON.stringify({
      changes: [{ path: "README.md", operation: "update", content: "model escaped scope\n" }],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-scope-"));
    const base = await boot(dataRoot, await fakeOllama(manifest));
    const setup = await createMission(base, dataRoot, 0);
    const jobId = await startGeneralJob(base, setup.missionId, "scope-job");
    const response = await command(base, "job.execute", "scope-execute", { jobId });
    expect(response.status).toBe(502);
    expect(
      readFileSync(join(dataRoot, `supervised/kernel-workspaces/${jobId}/README.md`), "utf8"),
    ).toBe("unrelated content must remain unchanged\n");
  });

  it("persists failed independent verification and creates no delivery", async () => {
    const manifest = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "still broken";\n',
        },
      ],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-verifier-"));
    const base = await boot(dataRoot, await fakeOllama(manifest));
    const setup = await createMission(base, dataRoot, 0);
    const jobId = await startGeneralJob(base, setup.missionId, "failed-job");
    const response = await command(base, "job.execute", "failed-execute", { jobId });
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "failed" },
      verification: { status: "failed" },
      decision: { decision: "no_verified_solution" },
      receipt: null,
    });
  });

  it("turns failed evidence into one immutable verified repair candidate", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-repair-"));
    const endpoint = await fakeOllama([
      JSON.stringify({
        changes: [
          {
            path: "src/greeting.mjs",
            operation: "update",
            content: 'export const greeting = "still broken";\n',
          },
        ],
      }),
      JSON.stringify({
        changes: [
          {
            path: "src/greeting.mjs",
            operation: "update",
            content: 'export const greeting = "hello world";\n',
          },
        ],
      }),
    ]);
    const base = await boot(dataRoot, endpoint);
    const setup = await createMission(base, dataRoot);
    const jobId = await startGeneralJob(base, setup.missionId, "repair-job");

    const response = await command(base, "job.execute", "repair-execute", { jobId });
    const body = (await response.json()) as {
      result?: {
        job: { status: string };
        candidate: { id: string; parentCandidateIds: readonly string[] };
        verification: { status: string };
        receipt: unknown;
      };
      error?: unknown;
    };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "completed" },
      candidate: { parentCandidateIds: [expect.stringMatching(/^candidate-/u)] },
      verification: { status: "passed" },
    });
    expect(body.result?.receipt).not.toBeNull();

    const candidates = await fetch(`${base}/queries/candidate.list`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        requestId: "repair-candidates",
        projectId: setup.projectId,
        missionId: setup.missionId,
        pagination: { limit: 10 },
      }),
    });
    expect(candidates.status).toBe(200);
    expect(await candidates.json()).toMatchObject({
      result: {
        candidates: [
          { original: true, parentCandidateIds: [] },
          { original: false, parentCandidateIds: [expect.stringMatching(/^candidate-/u)] },
        ],
        pagination: { total: 2 },
      },
    });

    const identity = createHash("sha256").update(`${jobId}:repair:1`).digest("hex").slice(0, 32);
    const issue = await fetch(`${base}/records/issue/issue-${identity}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(issue.status).toBe(200);
    expect(await issue.json()).toMatchObject({ record: { value: { status: "repaired" } } });
    const repair = await fetch(`${base}/records/repair/repair-${identity}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(repair.status).toBe(200);
    expect(await repair.json()).toMatchObject({
      record: {
        value: {
          status: "passed",
          sourceCandidateId: expect.stringMatching(/^candidate-/u),
          repairedCandidateId: `candidate-repair-${identity}`,
        },
      },
    });

    const retry = await command(base, "job.execute", "repair-execute", { jobId });
    expect(retry.status).toBe(200);
    const firstRuntime = runtimes.shift();
    await firstRuntime?.shutdown();
    const restartedBase = await boot(dataRoot, endpoint);
    const recovered = await fetch(`${restartedBase}/records/repair/repair-${identity}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ record: { value: { status: "passed" } } });

    const workspace = join(dataRoot, `supervised/kernel-workspaces/${jobId}`);
    expect(readFileSync(join(workspace, "src/greeting.mjs"), "utf8")).toContain("hello world");
  });

  it("stops with no verified solution when the declared repair budget is exhausted", async () => {
    const broken = JSON.stringify({
      changes: [
        {
          path: "src/greeting.mjs",
          operation: "update",
          content: 'export const greeting = "still broken";\n',
        },
      ],
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-repair-exhausted-"));
    const base = await boot(dataRoot, await fakeOllama([broken, broken]));
    const setup = await createMission(base, dataRoot, 1);
    const jobId = await startGeneralJob(base, setup.missionId, "exhausted-job");
    const response = await command(base, "job.execute", "exhausted-execute", { jobId });
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result).toMatchObject({
      job: { status: "failed" },
      candidate: { original: false },
      verification: { status: "failed" },
      decision: { decision: "no_verified_solution" },
      receipt: null,
    });
    const identity = createHash("sha256").update(`${jobId}:repair:1`).digest("hex").slice(0, 32);
    const repair = await fetch(`${base}/records/repair/repair-${identity}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(await repair.json()).toMatchObject({ record: { value: { status: "failed" } } });
  });

  it.runIf(process.env["V31M4_RUN_REAL_GENERAL_PROOF"] === "1")(
    "completes the general workflow with an installed local Ollama model",
    async () => {
      const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-general-real-"));
      const base = await boot(
        dataRoot,
        process.env["V31M4_OLLAMA_ENDPOINT"] ?? "http://127.0.0.1:11434",
      );
      const setup = await createMission(base, dataRoot);
      const jobId = await startGeneralJob(base, setup.missionId, "real-general-job");
      const response = await command(base, "job.execute", "real-general-execute", { jobId });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.result).toMatchObject({
        job: { status: "completed" },
        candidate: { configuration: { modelId: "devstral-small-2:24b" } },
        verification: { status: "passed" },
        decision: { decision: "champion" },
      });
    },
    180_000,
  );

  it.runIf(process.env["V31M4_RUN_REAL_REPAIR_PROOF"] === "1")(
    "repairs a failed real-model candidate from independent verifier evidence",
    async () => {
      const dataRoot = mkdtempSync(join(tmpdir(), "v31m4-repair-real-"));
      const base = await boot(
        dataRoot,
        process.env["V31M4_OLLAMA_ENDPOINT"] ?? "http://127.0.0.1:11434",
      );
      const setup = await createMission(
        base,
        dataRoot,
        1,
        "salutations from the verified velma fixture",
        false,
      );
      const jobId = await startGeneralJob(base, setup.missionId, "real-repair-job");
      const response = await command(base, "job.execute", "real-repair-execute", { jobId });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.result).toMatchObject({
        job: { status: "completed" },
        candidate: { original: false, parentCandidateIds: [expect.stringMatching(/^candidate-/u)] },
        verification: { status: "passed" },
        decision: { decision: "champion" },
      });
    },
    240_000,
  );
});
