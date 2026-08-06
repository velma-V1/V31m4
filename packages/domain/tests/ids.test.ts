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
  MissionId,
  ModelId,
  PluginId,
  ProjectId,
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
] as const;

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
});
