import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("adapter isolation", () => {
  it("keeps process, RPC, and adapter modules outside SQLite and secret implementations", () => {
    for (const directory of ["adapters", "processes", "rpc"]) {
      const root = join(import.meta.dirname, "..", "src", directory);
      for (const name of readdirSync(root)) {
        const source = readFileSync(join(root, name), "utf8");
        expect(source).not.toMatch(/node:sqlite|sqlite-runtime|leased-secret-store/u);
      }
    }
  });
});
