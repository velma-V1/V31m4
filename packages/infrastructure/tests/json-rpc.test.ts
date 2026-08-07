import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { JsonRpcClient, JsonRpcFramer, RpcProtocolError } from "../src/index.js";

describe("strict JSON-RPC transport", () => {
  it("frames split ordered messages and rejects malformed or oversized data", () => {
    const framer = new JsonRpcFramer({ maxBytes: 40 });
    expect(framer.push(Buffer.from('{"a":'))).toEqual([]);
    expect(framer.push(Buffer.from("1}\n"))).toEqual([{ a: 1 }]);
    expect(() => framer.push(Buffer.from("not-json\n"))).toThrow(RpcProtocolError);
    expect(() => new JsonRpcFramer({ maxBytes: 2 }).push(Buffer.from("123"))).toThrow(
      "exceeds limit",
    );
  });

  it("correlates responses and enforces timeout and cancellation", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.stdin.on('data',b=>{for(const l of b.toString().trim().split('\\n')){const r=JSON.parse(l);if(r.method==='echo')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:r.params})+'\\n')}})",
    ]);
    const client = new JsonRpcClient(child);
    await expect(client.call("echo", { ok: true }, 1_000)).resolves.toEqual({ ok: true });
    await expect(client.call("never", {}, 10)).rejects.toThrow("timed out");
    const controller = new AbortController();
    const cancelled = client.call("never", {}, 1_000, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    child.kill();
  });

  it("fails closed on protocol corruption", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.stdout.write('garbage\\n');setTimeout(()=>{},500)",
    ]);
    const client = new JsonRpcClient(child);
    await expect(client.call("echo", {}, 1_000)).rejects.toThrow("Malformed");
  });
});
