import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { ProcessSupervisor } from "../src/index.js";

describe("ProcessSupervisor", () => {
  it("reports spawn failure without retaining a phantom process", async () => {
    const supervisor = new ProcessSupervisor({ command: "v31m4-command-that-does-not-exist" });
    await expect(supervisor.start()).rejects.toThrow();
    expect(supervisor.process).toBeUndefined();
  });

  it("bounds stderr floods and reaps the process", async () => {
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "setInterval(()=>process.stderr.write('x'.repeat(2048)),1)"],
      stderrLimitBytes: 1024,
      shutdownTimeoutMs: 100,
    });
    const child = await supervisor.start();
    await once(child, "exit");
    expect(supervisor.process).toBeUndefined();
  });

  it("records why it ended a process, so callers can reconcile external effects", async () => {
    const natural = new ProcessSupervisor({ command: process.execPath, args: ["-e", ""] });
    const child = await natural.start();
    await once(child, "exit");
    // A self-directed exit is not a supervisor termination.
    expect(natural.terminationReason).toBeUndefined();

    const stopped = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      shutdownTimeoutMs: 100,
    });
    await stopped.start();
    await stopped.stop();
    expect(stopped.terminationReason).toBe("requested");
  });

  it("bounds stdout as well as stderr when a combined budget is set", async () => {
    // Bounding stderr alone leaves stdout free to flood; a caller that owns both streams opts
    // into combined accounting and gets an explicit output-limit termination.
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "setInterval(()=>process.stdout.write('x'.repeat(8192)),1)"],
      stderrLimitBytes: 1024 * 1024,
      maxCombinedOutputBytes: 4096,
      shutdownTimeoutMs: 100,
    });
    const child = await supervisor.start();
    await once(child, "exit");
    expect(supervisor.terminationReason).toBe("output_limit");
    expect(supervisor.process).toBeUndefined();
  });

  it("bounds stderr under the combined budget too", async () => {
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "setInterval(()=>process.stderr.write('x'.repeat(8192)),1)"],
      stderrLimitBytes: 1024 * 1024,
      maxCombinedOutputBytes: 4096,
      shutdownTimeoutMs: 100,
    });
    const child = await supervisor.start();
    await once(child, "exit");
    expect(supervisor.terminationReason).toBe("output_limit");
  });

  it("bounds the two streams jointly, not each on its own", async () => {
    // Neither stream alone exceeds the budget; together they do.
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: [
        "-e",
        "setInterval(()=>{process.stdout.write('a'.repeat(3000));process.stderr.write('b'.repeat(3000));},1)",
      ],
      stderrLimitBytes: 1024 * 1024,
      maxCombinedOutputBytes: 5000,
      shutdownTimeoutMs: 100,
    });
    const child = await supervisor.start();
    await once(child, "exit");
    expect(supervisor.terminationReason).toBe("output_limit");
  });

  it("leaves stdout untouched when no combined budget is configured", async () => {
    // Existing JSON-RPC adapter callers read stdout as a protocol channel; combined accounting
    // must stay opt-in so their stream behavior is unchanged.
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(200000))"],
      stderrLimitBytes: 1024,
    });
    const child = await supervisor.start();
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    await once(child, "exit");
    expect(bytes).toBe(200000);
    expect(supervisor.terminationReason).toBeUndefined();
  });

  it("stops a running process idempotently", async () => {
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      shutdownTimeoutMs: 100,
    });
    await supervisor.start();
    await supervisor.stop();
    await supervisor.stop();
    expect(supervisor.process).toBeUndefined();
  });

  it("inherits only allowlisted environment values plus explicit adapter configuration", async () => {
    process.env["V31M4_TEST_PARENT_SECRET"] = "must-not-cross";
    const supervisor = new ProcessSupervisor({
      command: process.execPath,
      args: [
        "-e",
        "setTimeout(()=>process.stdout.write(JSON.stringify({secret:process.env.V31M4_TEST_PARENT_SECRET,explicit:process.env.V31M4_ADAPTER_MODE,path:typeof process.env.PATH})),50)",
      ],
      environment: { V31M4_ADAPTER_MODE: "fixture" },
      inheritEnvironment: ["PATH"],
    });
    try {
      const child = await supervisor.start();
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      await once(child, "exit");
      expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
        explicit: "fixture",
        path: "string",
      });
    } finally {
      delete process.env["V31M4_TEST_PARENT_SECRET"];
      await supervisor.stop();
    }
  });
});
