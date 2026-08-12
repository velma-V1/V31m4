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
