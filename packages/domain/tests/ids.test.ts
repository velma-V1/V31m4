import { describe, expect, it } from "vitest";
import {
  AdapterId,
  ArtifactId,
  CandidateId,
  CapabilityId,
  CheckpointId,
  EventId,
  EvidenceId,
  IssueId,
  JobId,
  LedgerEntryId,
  MemoryId,
  MissionId,
  ModelId,
  PluginId,
  ProjectId,
  SandboxId,
  SkillId,
  TaskId,
  ToolId,
} from "../src/value-objects/ids.js";

const parsers = [
  ProjectId,
  MissionId,
  JobId,
  CheckpointId,
  ArtifactId,
  EvidenceId,
  CandidateId,
  IssueId,
  CapabilityId,
  PluginId,
  AdapterId,
  ModelId,
  ToolId,
  EventId,
  TaskId,
  SandboxId,
  LedgerEntryId,
  SkillId,
  MemoryId,
] as const;

/**
 * V31M4-AUTONOMY-001 / 1.1.0 Task 1: the autonomy program adds exactly five new durable
 * identifiers. They must obey the one existing canonical durable-ID contract — no parallel
 * identifier syntax, and no unvalidated string standing in for durable identity.
 */
const autonomyParsers = [TaskId, SandboxId, LedgerEntryId, SkillId, MemoryId] as const;

describe("durable identifiers", () => {
  it("accepts one canonical identifier format for every durable ID type", () => {
    for (const parser of parsers) {
      expect(parser.parse("v31m4:item_01.alpha")).toBe("v31m4:item_01.alpha");
      expect(parser.is("v31m4:item_01.alpha")).toBe(true);
    }
  });

  it.each(["", " id", "id ", "-leading", "contains space", "bad/slash", "x".repeat(129)])(
    "rejects invalid identifier %j",
    (value) => {
      for (const parser of parsers) {
        expect(() => parser.parse(value)).toThrow();
        expect(parser.is(value)).toBe(false);
      }
    },
  );

  it("adds the five autonomy identifiers under the same durable-ID invariants", () => {
    for (const parser of autonomyParsers) {
      expect(typeof parser.parse).toBe("function");
      expect(typeof parser.is).toBe("function");
      expect(parser.parse("task:root_01.alpha")).toBe("task:root_01.alpha");
      expect(() => parser.parse("../escape")).toThrow(/INVALID_ID|must begin/u);
      expect(parser.is(undefined)).toBe(false);
    }
  });
});
