import { ApplicationError } from "@v31m4/application";

/** A single authenticated local principal and its bearer token. */
export interface RuntimeSession {
  readonly token: string;
  readonly actorId: string;
  readonly roles: readonly string[];
}

export type ExecutionProfile = "hermetic_reference" | "supervised_local";

export interface SupervisedLocalConfig {
  readonly ollamaEndpoint: string;
  readonly model: string;
}

/** Fully validated runtime configuration. Construct only through {@link createRuntimeConfig}. */
export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly sessions: readonly RuntimeSession[];
  readonly eventQueueLimit: number;
  readonly replayBatchSize: number;
  readonly maxRequestBytes: number;
  readonly shutdownTimeoutMs: number;
  readonly executionProfile: ExecutionProfile;
  readonly supervisedLocal?: SupervisedLocalConfig;
}

export interface RuntimeConfigInput {
  readonly host?: string;
  readonly port: number;
  readonly databasePath: string;
  readonly sessions: readonly RuntimeSession[];
  readonly eventQueueLimit?: number;
  readonly replayBatchSize?: number;
  readonly maxRequestBytes?: number;
  readonly shutdownTimeoutMs?: number;
  readonly executionProfile?: ExecutionProfile;
  readonly supervisedLocal?: SupervisedLocalConfig;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/u;

function invalid(message: string, details: Record<string, string | number>): never {
  throw new ApplicationError("INVALID_APPLICATION_INPUT", message, { details });
}

function requireInt(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid(`${label} must be an integer in [${min}, ${max}].`, { label, value });
  }
  return value;
}

function parseEnvironmentInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    invalid(`${label} must be a canonical nonnegative integer.`, { label, value });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    invalid(`${label} must be a safe integer.`, { label, value });
  }
  return parsed;
}

function validateSupervisedLocal(value: SupervisedLocalConfig): SupervisedLocalConfig {
  let endpoint: URL;
  try {
    endpoint = new URL(value.ollamaEndpoint);
  } catch {
    invalid("Supervised local Ollama endpoint must be a valid URL.", {
      ollamaEndpoint: value.ollamaEndpoint,
    });
  }
  const hostname = endpoint.hostname === "[::1]" ? "::1" : endpoint.hostname;
  if (
    endpoint.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(hostname) ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0 ||
    (endpoint.pathname !== "/" && endpoint.pathname !== "") ||
    endpoint.search.length > 0 ||
    endpoint.hash.length > 0
  ) {
    invalid("Supervised local Ollama endpoint must be an uncredentialed loopback HTTP origin.", {
      ollamaEndpoint: value.ollamaEndpoint,
    });
  }
  if (!MODEL_NAME_PATTERN.test(value.model)) {
    invalid("Supervised local model name is invalid.", { model: value.model });
  }
  return Object.freeze({ ollamaEndpoint: endpoint.origin, model: value.model });
}

/**
 * Validates and freezes runtime configuration. The runtime is local-first: it binds a loopback
 * host, requires at least one session whose bearer token has real entropy, and rejects out-of-range
 * bounds rather than silently clamping them, so misconfiguration fails closed at startup.
 */
export function createRuntimeConfig(input: RuntimeConfigInput): RuntimeConfig {
  const host = input.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    invalid("Runtime host must be loopback for local-first operation.", { host });
  }
  const port = requireInt(input.port, "port", 0, 65535);
  if (input.databasePath.trim().length === 0) {
    invalid("Runtime database path is required.", { databasePath: input.databasePath });
  }
  if (input.sessions.length === 0) {
    invalid("At least one authenticated session is required.", { sessions: input.sessions.length });
  }
  const seenTokens = new Set<string>();
  const sessions = input.sessions.map((session) => {
    if (session.token.length < 16) {
      invalid("Session token must be at least 16 characters.", { actorId: session.actorId });
    }
    if (seenTokens.has(session.token)) {
      invalid("Session tokens must be unique.", { actorId: session.actorId });
    }
    seenTokens.add(session.token);
    if (!ID_PATTERN.test(session.actorId)) {
      invalid("Session actor id must use canonical durable-ID syntax.", {
        actorId: session.actorId,
      });
    }
    for (const role of session.roles) {
      if (!ID_PATTERN.test(role)) {
        invalid("Session role must use canonical durable-ID syntax.", { role });
      }
    }
    return Object.freeze({
      token: session.token,
      actorId: session.actorId,
      roles: Object.freeze([...session.roles]),
    });
  });
  const executionProfile = input.executionProfile ?? "hermetic_reference";
  if (executionProfile === "supervised_local" && input.supervisedLocal === undefined) {
    invalid("The supervised local execution profile requires Ollama configuration.", {
      executionProfile,
    });
  }
  if (executionProfile === "hermetic_reference" && input.supervisedLocal !== undefined) {
    invalid("Supervised local configuration requires the supervised_local execution profile.", {
      executionProfile,
    });
  }
  const supervisedLocal =
    input.supervisedLocal === undefined
      ? undefined
      : validateSupervisedLocal(input.supervisedLocal);
  return Object.freeze({
    host,
    port,
    databasePath: input.databasePath,
    sessions: Object.freeze(sessions),
    eventQueueLimit: requireInt(input.eventQueueLimit ?? 1024, "eventQueueLimit", 1, 1_000_000),
    replayBatchSize: requireInt(input.replayBatchSize ?? 512, "replayBatchSize", 1, 100_000),
    maxRequestBytes: requireInt(
      input.maxRequestBytes ?? 1_048_576,
      "maxRequestBytes",
      1,
      67_108_864,
    ),
    shutdownTimeoutMs: requireInt(
      input.shutdownTimeoutMs ?? 10_000,
      "shutdownTimeoutMs",
      0,
      600_000,
    ),
    executionProfile,
    ...(supervisedLocal === undefined ? {} : { supervisedLocal }),
  });
}

/** Loads and validates configuration from a process environment. */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const token = env["V31M4_AUTH_TOKEN"];
  const databasePath = env["V31M4_DATABASE"];
  if (token === undefined || databasePath === undefined) {
    invalid("V31M4_AUTH_TOKEN and V31M4_DATABASE are required.", {
      hasToken: token === undefined ? "no" : "yes",
      hasDatabase: databasePath === undefined ? "no" : "yes",
    });
  }
  const roles = (env["V31M4_ACTOR_ROLES"] ?? "operator")
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  const queueLimit = env["V31M4_EVENT_QUEUE_LIMIT"];
  const batchSize = env["V31M4_REPLAY_BATCH_SIZE"];
  const profileValue = env["V31M4_EXECUTION_PROFILE"] ?? "hermetic_reference";
  if (profileValue !== "hermetic_reference" && profileValue !== "supervised_local") {
    invalid("Execution profile V31M4_EXECUTION_PROFILE is invalid.", {
      executionProfile: profileValue,
    });
  }
  const executionProfile: ExecutionProfile = profileValue;
  const ollamaEndpoint = env["V31M4_OLLAMA_ENDPOINT"];
  const ollamaModel = env["V31M4_OLLAMA_MODEL"];
  if (
    executionProfile === "supervised_local" &&
    (ollamaEndpoint === undefined || ollamaModel === undefined)
  ) {
    invalid("The supervised local execution profile requires Ollama endpoint and model.", {
      hasEndpoint: ollamaEndpoint === undefined ? "no" : "yes",
      hasModel: ollamaModel === undefined ? "no" : "yes",
    });
  }
  return createRuntimeConfig({
    host: env["V31M4_HOST"] ?? "127.0.0.1",
    port: parseEnvironmentInteger(env["V31M4_PORT"], 8787, "V31M4_PORT"),
    databasePath,
    sessions: [{ token, actorId: env["V31M4_ACTOR_ID"] ?? "operator", roles }],
    executionProfile,
    ...(executionProfile === "supervised_local" &&
    ollamaEndpoint !== undefined &&
    ollamaModel !== undefined
      ? { supervisedLocal: { ollamaEndpoint, model: ollamaModel } }
      : {}),
    ...(queueLimit === undefined
      ? {}
      : { eventQueueLimit: parseEnvironmentInteger(queueLimit, 1024, "V31M4_EVENT_QUEUE_LIMIT") }),
    ...(batchSize === undefined
      ? {}
      : { replayBatchSize: parseEnvironmentInteger(batchSize, 512, "V31M4_REPLAY_BATCH_SIZE") }),
  });
}
