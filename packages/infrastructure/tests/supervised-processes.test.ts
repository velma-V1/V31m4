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
});
