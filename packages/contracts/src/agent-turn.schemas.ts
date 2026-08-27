import { containsPrivateReasoningKey } from "@v31m4/domain";
import { z } from "zod";
import {
  artifactIdSchema,
  guardForbiddenKeys,
  invocationIdSchema,
  jobIdSchema,
  modelIdSchema,
  resourceBudgetSchema,
  safeJsonObjectSchema,
} from "./common.schemas.js";
import { modelInvocationUsageSchema } from "./models.schemas.js";

/**
 * The provider-neutral structured agent-turn output contract.
 *
 * A model's turn is a bounded, actionable proposal and nothing else: call one allowed semantic
 * operation, declare the bounded task ready for independent verification, or say it cannot
 * proceed. There is no free-form channel, no "plan" field, and above all no place to put private
 * reasoning — see `PRIVATE_REASONING_KEYS`.
 *
 * This module owns wire syntax only. It is deliberately not a second operation registry: the
 * closed set of semantic operations lives in the runtime catalog, and a turn naming an operation
 * outside it is refused there, after this schema has proved the turn is well formed. A turn that
 * parses here is still an untrusted proposal.
 *
 * Versioned separately from the adapter protocol: an adapter negotiates protocol `1.1.0` and,
 * within it, states which agent-turn output contract it speaks.
 */
export const AGENT_TURN_CONTRACT_VERSION = "1.0.0" as const;
export const agentTurnContractVersionSchema = z.literal(AGENT_TURN_CONTRACT_VERSION);

export const AGENT_TURN_KINDS = Object.freeze(["tool_call", "finish", "defer"] as const);
export type AgentTurnKind = (typeof AGENT_TURN_KINDS)[number];

export const AGENT_REASONING_POLICIES = Object.freeze(["disabled", "enabled", "auto"] as const);
export type AgentReasoningPolicy = (typeof AGENT_REASONING_POLICIES)[number];

/**
 * Provider-neutral reasoning policy. `disabled` and `enabled` are explicit instructions and
 * `auto` leaves the choice to the runtime that actually knows the model. Translating this into a
 * provider flag — Ollama's `think`, or anything else — happens inside the adapter, never here and
 * never in the runtime, so no V31M4 invariant depends on one vendor's semantics.
 *
 * Whatever a runtime produces while reasoning is ephemeral. It is never requested back, never
 * returned, and never persisted.
 */
export const agentReasoningPolicySchema = z.enum(AGENT_REASONING_POLICIES);

/**
 * Private reasoning is refused at the contract boundary, using the one frozen domain definition.
 *
 * Strict objects already reject an unknown top-level key, but `parameters` is a model-supplied
 * JSON bag that is fingerprinted and persisted with the Execution Ledger entry, so reasoning
 * smuggled inside it would become durable. The domain guard therefore runs at every depth, and a
 * match is a rejection rather than a silent strip.
 */
export {
  containsPrivateReasoningKey,
  isPrivateReasoningKey,
  PRIVATE_REASONING_KEYS,
} from "@v31m4/domain";

/**
 * Wraps a schema so raw input carrying a private-reasoning property name at any depth is refused
 * before object parsing runs. Composed with `guardForbiddenKeys` at every agent boundary.
 */
export function guardPrivateReasoning<S extends z.ZodType>(schema: S) {
  return z
    .unknown()
    .superRefine((value, context) => {
      if (containsPrivateReasoningKey(value)) {
        context.addIssue({
          code: "custom",
          message:
            "An agent turn must not carry private reasoning; chain-of-thought is never evidence or memory.",
        });
      }
    })
    .pipe(schema);
}

/**
 * Syntax of a V31M4 semantic operation ID (`repo.search`, `code.patch`, ...).
 *
 * Form only. The closed set of operations is owned by the runtime `SemanticOperationDefinition`
 * registry, and duplicating that list on the wire would create a second source of truth, so an
 * unknown operation is rejected by the registry rather than by this schema.
 */
export const agentOperationIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u,
    "Semantic operation ID must be a lowercase `group.operation` pair.",
  );

/**
 * Bounded free text in a turn. Capped below the Execution Ledger's own text limit so every turn a
 * model can produce is recordable in authoritative history without truncation.
 */
const agentTurnTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => value === value.trim(), "Text cannot contain outer whitespace.");

export const agentToolCallTurnSchema = z
  .object({
    kind: z.literal("tool_call"),
    operation: agentOperationIdSchema,
    parameters: safeJsonObjectSchema,
  })
  .strict();

/**
 * `finish` declares the bounded task ready for **independent verification**. It is not a success
 * claim, and no acceptance decision may be derived from it — a model never certifies its own work.
 */
export const agentFinishTurnSchema = z
  .object({ kind: z.literal("finish"), summary: agentTurnTextSchema })
  .strict();

export const agentDeferTurnSchema = z
  .object({ kind: z.literal("defer"), reason: agentTurnTextSchema })
  .strict();

const agentTurnUnionSchema = z.discriminatedUnion("kind", [
  agentToolCallTurnSchema,
  agentFinishTurnSchema,
  agentDeferTurnSchema,
]);

/** The canonical agent-turn parser. Both guards run before the union sees the value. */
export const agentTurnSchema = guardForbiddenKeys(guardPrivateReasoning(agentTurnUnionSchema));

/**
 * The explicit context budget an agent invocation runs under.
 *
 * Two limits, because they answer different questions: the byte ceiling is what the transport and
 * the adapter can physically carry, and the token budget is what the model can actually attend to.
 * Both are supplied per invocation rather than compiled into an adapter, and exceeding either
 * fails closed — a truncated context silently changes the task the model was given.
 */
export const agentContextBudgetSchema = z
  .object({
    maxPromptBytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024),
    maxPromptTokens: z.number().int().min(1).max(2_000_000),
  })
  .strict();

const agentTurnInvocationParamsShape = {
  invocationId: invocationIdSchema,
  jobId: jobIdSchema,
  taskId: z.string().min(1).max(128),
  modelId: modelIdSchema,
  promptArtifactId: artifactIdSchema,
  outputContractVersion: agentTurnContractVersionSchema,
  /** The role manifest, resolved by the runtime. The adapter may offer nothing beyond it. */
  allowedOperations: z.array(agentOperationIdSchema).min(1).max(64),
  reasoningPolicy: agentReasoningPolicySchema,
  contextBudget: agentContextBudgetSchema,
  resourceBudget: resourceBudgetSchema,
} as const;

export const agentTurnInvocationParamsSchema = z
  .object(agentTurnInvocationParamsShape)
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.allowedOperations).size !== value.allowedOperations.length) {
      context.addIssue({
        code: "custom",
        message: "Allowed operations must be unique.",
        path: ["allowedOperations"],
      });
    }
  });

const agentTurnInvocationResultShape = {
  invocationId: invocationIdSchema,
  modelId: modelIdSchema,
  outputContractVersion: agentTurnContractVersionSchema,
  turn: agentTurnSchema,
  usage: modelInvocationUsageSchema,
  metadata: safeJsonObjectSchema,
} as const;

export const agentTurnInvocationResultSchema = guardPrivateReasoning(
  z.object(agentTurnInvocationResultShape).strict(),
);

export { agentTurnInvocationParamsShape, agentTurnInvocationResultShape };

export type AgentToolCallTurn = z.infer<typeof agentToolCallTurnSchema>;
export type AgentFinishTurn = z.infer<typeof agentFinishTurnSchema>;
export type AgentDeferTurn = z.infer<typeof agentDeferTurnSchema>;
export type AgentTurn = z.infer<typeof agentTurnUnionSchema>;
export type AgentContextBudget = z.infer<typeof agentContextBudgetSchema>;
export type AgentTurnInvocationParams = z.infer<typeof agentTurnInvocationParamsSchema>;
export type AgentTurnInvocationResult = z.infer<typeof agentTurnInvocationResultSchema>;
