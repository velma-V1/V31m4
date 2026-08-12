export interface SoftwareProductionChange {
  readonly path: string;
  readonly operation: "create" | "update" | "delete";
  readonly content?: string;
}

export function applyChangeManifest(
  workspace: string,
  changes: readonly SoftwareProductionChange[],
): Promise<void>;
