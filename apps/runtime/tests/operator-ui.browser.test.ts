import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { type RunningRuntime, startRuntime } from "../src/bootstrap.js";
import { createRuntimeConfig } from "../src/runtime-config.js";

const OPERATOR_TOKEN = "token-abcdefghijklmnop";

function runtimeConfig(databasePath: string, port: number) {
  return createRuntimeConfig({
    port,
    databasePath,
    sessions: [{ token: OPERATOR_TOKEN, actorId: "operator", roles: ["operator"] }],
    shutdownTimeoutMs: 500,
  });
}

async function waitForText(locator: Locator, expected: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => locator.textContent(), { timeout }).toContain(expected);
}

async function renderedJson<T>(page: Page, resultSelector: string): Promise<T> {
  const text = await page.locator(`${resultSelector} pre`).textContent();
  if (text === null) throw new Error(`No rendered JSON found in ${resultSelector}.`);
  return JSON.parse(text) as T;
}

async function eventTexts(page: Page): Promise<readonly string[]> {
  return page.locator("#events li").allTextContents();
}

async function waitForEvent(page: Page, eventType: string): Promise<void> {
  await expect
    .poll(async () => (await eventTexts(page)).join("\n"), { timeout: 10_000 })
    .toContain(eventType);
}

function eventSequences(texts: readonly string[]): readonly number[] {
  return texts.map((text) => {
    const match = /^#(\d+)\b/u.exec(text);
    if (match?.[1] === undefined) throw new Error(`Event has no displayed sequence: ${text}`);
    return Number.parseInt(match[1], 10);
  });
}

describe("operator UI real-browser proof", () => {
  it("authenticates, drives the full workflow, resumes SSE, and reads recovered state after restart", async () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), "v31m4-browser-ui-")), "state.db");
    let runtime: RunningRuntime | undefined = await startRuntime(runtimeConfig(databasePath, 0));
    const port = runtime.address.port;
    const base = `http://127.0.0.1:${port}`;
    let browser: Browser | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(base);

      await waitForText(page.locator("#health"), "status: ok");
      await expect(page.locator("#eventsStatus").textContent()).resolves.toContain("not connected");

      // Real negative path: the public UI can load without a credential, but its first command
      // must be rejected by the authenticated runtime boundary and render that denial to the user.
      await page.locator("#projectName").fill("Browser Proof Project");
      await page.locator("#projectRootPath").fill("browser-proof");
      await page.locator("#createProject").click();
      await waitForText(page.locator("#projectResult"), "PERMISSION_DENIED");

      await page.locator("#token").fill(OPERATOR_TOKEN);
      await page.locator("#saveToken").click();
      await waitForText(page.locator("#tokenStatus"), "saved");
      await waitForText(page.locator("#eventsStatus"), "connected (after sequence 0)");

      await page.locator("#createProject").click();
      await waitForText(page.locator("#projectResult"), "ok");
      const project = await renderedJson<{ id: string; name: string; status: string }>(
        page,
        "#projectResult",
      );
      expect(project.name).toBe("Browser Proof Project");
      expect(project.status).toBe("active");
      expect(await page.locator("#missionProjectId").textContent()).toBe(project.id);

      const missionPayload = JSON.parse(await page.locator("#missionPayload").inputValue()) as {
        projectId: string;
        title: string;
      };
      expect(missionPayload.projectId).toBe(project.id);
      expect(missionPayload.title).toBe("Demo Mission");
      await page.locator("#submitMission").click();
      await waitForText(page.locator("#missionResult"), "ok");
      const mission = await renderedJson<{ id: string; projectId: string; title: string }>(
        page,
        "#missionResult",
      );
      expect(mission.projectId).toBe(project.id);
      expect(mission.title).toBe("Demo Mission");
      expect(await page.locator("#jobMissionId").textContent()).toBe(mission.id);

      await page.locator("#startJob").click();
      await waitForText(page.locator("#startJobResult"), "ok");
      const startedJob = await renderedJson<{
        id: string;
        missionId: string;
        status: string;
      }>(page, "#startJobResult");
      expect(startedJob.missionId).toBe(mission.id);
      expect(startedJob.status).toBe("running");
      expect(await page.locator("#executeJobId").textContent()).toBe(startedJob.id);

      await page.locator("#executeJob").click();
      await waitForText(page.locator("#executeJobResult"), "ok", 15_000);
      const executed = await renderedJson<{
        job: { id: string; status: string; progress: number };
        candidate: { missionId: string };
        verification: { status: string; mandatoryChecksPassed: number };
        decision: { decision: string; missionId: string };
        receipt: { missionId: string; decision: string } | null;
      }>(page, "#executeJobResult");
      expect(executed.job).toMatchObject({ id: startedJob.id, status: "completed", progress: 1 });
      expect(executed.candidate.missionId).toBe(mission.id);
      expect(executed.verification).toMatchObject({
        status: "passed",
        mandatoryChecksPassed: 1,
      });
      expect(executed.decision).toMatchObject({ decision: "champion", missionId: mission.id });
      expect(executed.receipt).toMatchObject({ decision: "champion", missionId: mission.id });

      for (const eventType of [
        "project.updated",
        "mission.submitted",
        "job.created",
        "job.queued",
        "job.started",
        "job.progressed",
        "job.completed",
      ]) {
        await waitForEvent(page, eventType);
      }
      const eventsBeforeRestart = await eventTexts(page);
      const sequencesBeforeRestart = eventSequences(eventsBeforeRestart);
      const headBeforeRestart = Math.max(...sequencesBeforeRestart);
      expect(new Set(sequencesBeforeRestart).size).toBe(sequencesBeforeRestart.length);

      await runtime.shutdown();
      runtime = undefined;

      // A brand-new runtime instance keeps only the SQLite file. The browser stays open so its
      // streaming reader must observe the disconnect, reconnect to the same origin with its last
      // sequence cursor, and continue from the durable log rather than replaying displayed events.
      runtime = await startRuntime(runtimeConfig(databasePath, port));
      expect(runtime.startup.latestSequence).toBe(headBeforeRestart);
      await waitForText(
        page.locator("#eventsStatus"),
        `connected (after sequence ${headBeforeRestart})`,
        10_000,
      );
      await waitForText(page.locator("#health"), `durable log head: ${headBeforeRestart}`, 10_000);

      const recovered = await page.evaluate(
        async ({ jobId, token }) => {
          const response = await fetch(`/records/job/${jobId}`, {
            headers: { authorization: `Bearer ${token}` },
          });
          return {
            status: response.status,
            body: (await response.json()) as { record?: { value?: { status?: string } } },
          };
        },
        { jobId: startedJob.id, token: OPERATOR_TOKEN },
      );
      expect(recovered.status).toBe(200);
      expect(recovered.body.record?.value?.status).toBe("completed");
      expect(await page.locator("#executeJobResult").textContent()).toContain(startedJob.id);

      await page.locator("#projectName").fill("After Restart Project");
      await page.locator("#projectRootPath").fill("after-restart");
      await page.locator("#createProject").click();
      await waitForText(page.locator("#projectResult"), "After Restart Project");
      await expect
        .poll(async () => eventSequences(await eventTexts(page))[0], { timeout: 10_000 })
        .toBe(headBeforeRestart + 1);

      const eventsAfterRestart = await eventTexts(page);
      const sequencesAfterRestart = eventSequences(eventsAfterRestart);
      expect(eventsAfterRestart[0]).toContain("project.updated");
      expect(sequencesAfterRestart).toHaveLength(sequencesBeforeRestart.length + 1);
      expect(new Set(sequencesAfterRestart).size).toBe(sequencesAfterRestart.length);
    } finally {
      await browser?.close();
      await runtime?.shutdown();
    }
  }, 30_000);
});
