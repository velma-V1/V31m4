import { describe, expect, it } from "vitest";
import { SafePath } from "../src/value-objects/safe-path.js";

describe("SafePath", () => {
  it("accepts canonical nested project-relative paths", () => {
    const path = SafePath.parse("assets/vehicles/tractor.i3d");

    expect(path).toBe("assets/vehicles/tractor.i3d");
    expect(SafePath.basename(path)).toBe("tractor.i3d");
    expect(SafePath.parent(path)).toBe("assets/vehicles");
    expect(SafePath.join(SafePath.parse("assets"), "textures", "body.dds")).toBe(
      "assets/textures/body.dds",
    );
  });

  it.each([
    "",
    "/absolute/path",
    "C:/drive/path",
    "\\\\server\\share",
    "folder\\file",
    "folder//file",
    "folder/../file",
    "folder/./file",
    "folder/",
    "folder/NUL",
    "folder/con.txt",
    "folder/file?.txt",
    " folder/file",
    "folder/file ",
    "folder/name.",
  ])("rejects unsafe path %j", (value) => {
    expect(() => SafePath.parse(value)).toThrow();
    expect(SafePath.is(value)).toBe(false);
  });

  it("returns null for the parent of a top-level path", () => {
    expect(SafePath.parent(SafePath.parse("README.md"))).toBe(null);
  });
});
