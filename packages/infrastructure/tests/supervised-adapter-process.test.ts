import { describe, expect, it } from "vitest";
import { SupervisedAdapterProcess } from "../src/adapters/supervised-adapter-process.js";

const FIXTURE = String.raw`
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf('\n');
    if (index < 0) break;
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    const request = JSON.parse(line);
    if (request.method === 'exit') process.exit(17);
    if (request.method === 'malformed') process.stdout.write('not-json\n');
    if (request.method === 'never') continue;
    if (request.method === 'echo') {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result:request.params}) + '\n');
    }
  }
});
`;

function processAdapter(): SupervisedAdapterProcess {
  return new SupervisedAdapterProcess({
    id: "fixture-adapter",
    process: { command: process.execPath, args: ["-e", FIXTURE] },
    maxFrameBytes: 4096,
  });
}

describe("SupervisedAdapterProcess", () => {
  it("starts lazily and invokes a real child through bounded JSON-RPC", async () => {
    const adapter = processAdapter();
    expect(adapter.running).toBe(false);
    await expect(adapter.invoke("echo", { value: 7 }, { timeoutMs: 1_000 })).resolves.toEqual({
      value: 7,
    });
    expect(adapter.running).toBe(true);
    await adapter.stop();
    expect(adapter.available()).toBe(false);
  });

  it("classifies malformed output, timeout, cancellation, and process exit as failures", async () => {
    const adapter = processAdapter();
    await expect(adapter.invoke("malformed", {}, { timeoutMs: 1_000 })).rejects.toThrow(
      /malformed/i,
    );

    const timeoutAdapter = processAdapter();
    await expect(timeoutAdapter.invoke("never", {}, { timeoutMs: 10 })).rejects.toThrow(
      /timed out/i,
    );
    expect(timeoutAdapter.running).toBe(false);
    await expect(
      timeoutAdapter.invoke("echo", { restarted: "after-timeout" }, { timeoutMs: 1_000 }),
    ).resolves.toEqual({ restarted: "after-timeout" });

    const cancelAdapter = processAdapter();
    const controller = new AbortController();
    const cancelled = cancelAdapter.invoke(
      "never",
      {},
      { timeoutMs: 1_000, signal: controller.signal },
    );
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/i);
    expect(cancelAdapter.running).toBe(false);
    await expect(
      cancelAdapter.invoke("echo", { restarted: "after-cancel" }, { timeoutMs: 1_000 }),
    ).resolves.toEqual({ restarted: "after-cancel" });

    const exitAdapter = processAdapter();
    await expect(exitAdapter.invoke("exit", {}, { timeoutMs: 1_000 })).rejects.toThrow(/exited/i);
    await Promise.all([
      adapter.stop(),
      timeoutAdapter.stop(),
      cancelAdapter.stop(),
      exitAdapter.stop(),
    ]);
  });

  it("starts a fresh child after an unexpected exit", async () => {
    const adapter = processAdapter();
    await expect(adapter.invoke("exit", {}, { timeoutMs: 1_000 })).rejects.toThrow(/exited/i);
    await expect(
      adapter.invoke("echo", { restarted: true }, { timeoutMs: 1_000 }),
    ).resolves.toEqual({
      restarted: true,
    });
    await adapter.stop();
  });
});
