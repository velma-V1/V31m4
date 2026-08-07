import { assertDomain } from "../domain-errors.js";
import {
  EvidenceId,
  type EvidenceId as EvidenceIdType,
  ProjectId,
  type ProjectId as ProjectIdType,
  TwinEdgeId,
  type TwinEdgeId as TwinEdgeIdType,
  TwinNodeId,
  type TwinNodeId as TwinNodeIdType,
} from "../value-objects/ids.js";

export type TwinNodeKind =
  | "requirement"
  | "acceptance_criterion"
  | "source_file"
  | "component"
  | "web_layout"
  | "three_d_asset"
  | "scene"
  | "shot"
  | "timeline"
  | "audio_track"
  | "research_claim"
  | "artifact"
  | "test"
  | "evidence";

export interface ProductionTwinNode {
  readonly id: TwinNodeIdType;
  readonly projectId: ProjectIdType;
  readonly kind: TwinNodeKind;
  readonly label: string;
  readonly externalReference?: string;
}

export type TwinEdgeKind =
  | "implements"
  | "depends_on"
  | "verifies"
  | "derived_from"
  | "renders"
  | "contains"
  | "conflicts_with"
  | "supersedes";

export interface ProductionTwinEdge {
  readonly id: TwinEdgeIdType;
  readonly projectId: ProjectIdType;
  readonly fromNodeId: TwinNodeIdType;
  readonly toNodeId: TwinNodeIdType;
  readonly kind: TwinEdgeKind;
  readonly evidenceIds: readonly EvidenceIdType[];
}

const NODE_KINDS = new Set<TwinNodeKind>([
  "requirement",
  "acceptance_criterion",
  "source_file",
  "component",
  "web_layout",
  "three_d_asset",
  "scene",
  "shot",
  "timeline",
  "audio_track",
  "research_claim",
  "artifact",
  "test",
  "evidence",
]);
const EDGE_KINDS = new Set<TwinEdgeKind>([
  "implements",
  "depends_on",
  "verifies",
  "derived_from",
  "renders",
  "contains",
  "conflicts_with",
  "supersedes",
]);

export const ProductionTwin = Object.freeze({
  createNode(input: {
    readonly id: string;
    readonly projectId: string;
    readonly kind: TwinNodeKind;
    readonly label: string;
    readonly externalReference?: string;
  }): ProductionTwinNode {
    assertDomain(
      NODE_KINDS.has(input.kind),
      "INVALID_PRODUCTION_TWIN",
      "Twin node kind is invalid.",
    );
    assertDomain(
      input.label.length > 0 && input.label === input.label.trim() && input.label.length <= 240,
      "INVALID_PRODUCTION_TWIN",
      "Twin node label must be canonical and contain between 1 and 240 characters.",
    );
    if (input.externalReference !== undefined) {
      assertDomain(
        input.externalReference.length > 0 &&
          input.externalReference === input.externalReference.trim() &&
          input.externalReference.length <= 1000,
        "INVALID_PRODUCTION_TWIN",
        "Twin node external reference must be canonical.",
      );
    }
    return Object.freeze({
      id: TwinNodeId.parse(input.id),
      projectId: ProjectId.parse(input.projectId),
      kind: input.kind,
      label: input.label,
      ...(input.externalReference === undefined
        ? {}
        : { externalReference: input.externalReference }),
    });
  },

  createEdge(input: {
    readonly id: string;
    readonly projectId: string;
    readonly fromNodeId: string;
    readonly toNodeId: string;
    readonly kind: TwinEdgeKind;
    readonly evidenceIds?: readonly string[];
  }): ProductionTwinEdge {
    assertDomain(
      EDGE_KINDS.has(input.kind),
      "INVALID_PRODUCTION_TWIN",
      "Twin edge kind is invalid.",
    );
    const fromNodeId = TwinNodeId.parse(input.fromNodeId);
    const toNodeId = TwinNodeId.parse(input.toNodeId);
    assertDomain(
      fromNodeId !== toNodeId,
      "INVALID_PRODUCTION_TWIN",
      "Twin edges cannot connect a node to itself.",
    );
    const evidenceIds = (input.evidenceIds ?? []).map((id) => EvidenceId.parse(id));
    assertDomain(
      new Set(evidenceIds).size === evidenceIds.length,
      "INVALID_PRODUCTION_TWIN",
      "Twin edge evidence IDs must be unique.",
    );
    assertDomain(
      input.kind !== "verifies" || evidenceIds.length > 0,
      "INVALID_PRODUCTION_TWIN",
      "Verification edges must reference evidence.",
    );
    return Object.freeze({
      id: TwinEdgeId.parse(input.id),
      projectId: ProjectId.parse(input.projectId),
      fromNodeId,
      toNodeId,
      kind: input.kind,
      evidenceIds: Object.freeze(evidenceIds),
    });
  },
});
