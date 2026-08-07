import { assertDomain } from "../domain-errors.js";
import type { Brand } from "./ids.js";

export type SafePath = Brand<string, "SafeProjectRelativePath">;

const MAX_PATH_LENGTH = 4096;
const FORBIDDEN_SEGMENT_CHARACTERS = /[<>:"|?*\u0000-\u001F]/u;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const DRIVE_PREFIX = /^[A-Za-z]:/u;

function validateSegment(segment: string, fullPath: string): void {
  assertDomain(segment.length > 0, "INVALID_SAFE_PATH", "Path cannot contain empty segments.", {
    path: fullPath,
  });
  assertDomain(
    segment !== "." && segment !== "..",
    "INVALID_SAFE_PATH",
    "Path traversal is forbidden.",
    { path: fullPath, segment },
  );
  assertDomain(
    segment === segment.trim(),
    "INVALID_SAFE_PATH",
    "Path segments cannot contain outer whitespace.",
    { path: fullPath, segment },
  );
  assertDomain(
    !segment.endsWith("."),
    "INVALID_SAFE_PATH",
    "Path segments cannot end with a period.",
    { path: fullPath, segment },
  );
  assertDomain(
    !FORBIDDEN_SEGMENT_CHARACTERS.test(segment),
    "INVALID_SAFE_PATH",
    "Path contains characters forbidden by the cross-platform path policy.",
    { path: fullPath, segment },
  );
  assertDomain(
    !WINDOWS_DEVICE_NAME.test(segment),
    "INVALID_SAFE_PATH",
    "Windows device names are forbidden in project-relative paths.",
    { path: fullPath, segment },
  );
}

export const SafePath = Object.freeze({
  parse(value: string): SafePath {
    assertDomain(typeof value === "string", "INVALID_SAFE_PATH", "Safe path must be a string.");
    assertDomain(value.length > 0, "INVALID_SAFE_PATH", "Safe path cannot be empty.");
    assertDomain(
      value.length <= MAX_PATH_LENGTH,
      "INVALID_SAFE_PATH",
      `Safe path cannot exceed ${MAX_PATH_LENGTH} characters.`,
      { length: value.length },
    );
    assertDomain(
      value === value.trim(),
      "INVALID_SAFE_PATH",
      "Safe path cannot contain outer whitespace.",
      { path: value },
    );
    assertDomain(!value.startsWith("/"), "INVALID_SAFE_PATH", "Absolute paths are forbidden.", {
      path: value,
    });
    assertDomain(!value.startsWith("\\"), "INVALID_SAFE_PATH", "UNC paths are forbidden.", {
      path: value,
    });
    assertDomain(
      !DRIVE_PREFIX.test(value),
      "INVALID_SAFE_PATH",
      "Drive-qualified paths are forbidden.",
      { path: value },
    );
    assertDomain(
      !value.includes("\\"),
      "INVALID_SAFE_PATH",
      "Backslashes are forbidden; use '/'.",
      { path: value },
    );
    assertDomain(!value.endsWith("/"), "INVALID_SAFE_PATH", "Safe path cannot end with '/'.", {
      path: value,
    });

    const segments = value.split("/");
    for (const segment of segments) {
      validateSegment(segment, value);
    }

    return value as SafePath;
  },

  is(value: unknown): value is SafePath {
    if (typeof value !== "string") {
      return false;
    }
    try {
      SafePath.parse(value);
      return true;
    } catch {
      return false;
    }
  },

  join(base: SafePath, ...segments: readonly string[]): SafePath {
    assertDomain(
      segments.length > 0,
      "INVALID_SAFE_PATH",
      "At least one path segment is required.",
    );
    return SafePath.parse([base, ...segments].join("/"));
  },

  parent(value: SafePath): SafePath | null {
    const separatorIndex = value.lastIndexOf("/");
    return separatorIndex === -1 ? null : SafePath.parse(value.slice(0, separatorIndex));
  },

  basename(value: SafePath): string {
    const separatorIndex = value.lastIndexOf("/");
    return separatorIndex === -1 ? value : value.slice(separatorIndex + 1);
  },
});
