import { z } from "zod";
import {
  canonicalIdSchema,
  canonicalStatementSchema,
  contractVersionSchema,
  mediaTypeSchema,
  projectIdSchema,
  safePathSchema,
} from "./common.schemas.js";

const commandArgumentSchema = z
  .string()
  .max(1_024)
  .refine((value) => !value.includes("\0") && !value.includes("\n") && !value.includes("\r"), {
    message: "Command arguments cannot contain control separators.",
  });

export const softwareOperationSchema = z.enum(["read", "create", "update", "delete"]);

export const softwareCommandSchema = z
  .object({
    id: canonicalIdSchema,
    executable: z.literal("node"),
    args: z.array(commandArgumentSchema).max(64),
    cwd: z.union([z.literal("."), safePathSchema]),
    timeoutMs: z.number().int().min(1).max(300_000),
  })
  .strict();

export const softwareBuildPacketSchema = z
  .object({
    schemaVersion: contractVersionSchema,
    projectId: projectIdSchema,
    objective: canonicalStatementSchema,
    requiredOutputs: z
      .array(z.object({ path: safePathSchema, mediaType: mediaTypeSchema }).strict())
      .min(1)
      .max(128),
    forbiddenChanges: z.array(safePathSchema).max(128),
    allowedPaths: z.array(safePathSchema).min(1).max(128),
    allowedOperations: z.array(softwareOperationSchema).min(1).max(4),
    commands: z.array(softwareCommandSchema).min(1).max(32),
    mandatoryCommandIds: z.array(canonicalIdSchema).min(1).max(32),
    resourceBudget: z
      .object({
        maxFiles: z.number().int().min(1).max(10_000),
        maxFileBytes: z
          .number()
          .int()
          .min(1)
          .max(16 * 1024 * 1024),
        maxTotalBytes: z
          .number()
          .int()
          .min(1)
          .max(256 * 1024 * 1024),
        maxRepairRounds: z.number().int().min(0).max(16),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    requireUnique(value.allowedPaths, "Allowed paths", ["allowedPaths"], context);
    requireUnique(value.forbiddenChanges, "Forbidden changes", ["forbiddenChanges"], context);
    requireUnique(value.allowedOperations, "Allowed operations", ["allowedOperations"], context);
    requireUnique(
      value.requiredOutputs.map((output) => output.path),
      "Required output paths",
      ["requiredOutputs"],
      context,
    );
    requireUnique(
      value.commands.map((command) => command.id),
      "Command IDs",
      ["commands"],
      context,
    );
    requireUnique(
      value.mandatoryCommandIds,
      "Mandatory command IDs",
      ["mandatoryCommandIds"],
      context,
    );
    const commandIds = new Set(value.commands.map((command) => command.id));
    for (const [index, id] of value.mandatoryCommandIds.entries()) {
      if (!commandIds.has(id)) {
        context.addIssue({
          code: "custom",
          message: "Mandatory commands must reference declared command IDs.",
          path: ["mandatoryCommandIds", index],
        });
      }
    }
    for (const [index, output] of value.requiredOutputs.entries()) {
      if (value.forbiddenChanges.some((path) => containsPath(path, output.path))) {
        context.addIssue({
          code: "custom",
          message: "Required outputs cannot be forbidden changes.",
          path: ["requiredOutputs", index, "path"],
        });
      }
      if (!value.allowedPaths.some((path) => containsPath(path, output.path))) {
        context.addIssue({
          code: "custom",
          message: "Required outputs must be within an allowed path.",
          path: ["requiredOutputs", index, "path"],
        });
      }
    }
  });

function containsPath(scope: string, path: string): boolean {
  return path === scope || path.startsWith(`${scope}/`);
}

function requireUnique(
  values: readonly string[],
  label: string,
  path: (string | number)[],
  context: {
    addIssue(issue: { code: "custom"; message: string; path: (string | number)[] }): void;
  },
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: `${label} must be unique.`, path });
  }
}

export type SoftwareOperation = z.infer<typeof softwareOperationSchema>;
export type SoftwareCommand = z.infer<typeof softwareCommandSchema>;
export type SoftwareBuildPacket = z.infer<typeof softwareBuildPacketSchema>;
