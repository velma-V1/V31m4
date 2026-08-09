#!/usr/bin/env node
import { spawn } from "node:child_process";
// Single dev launch path for the V31M4 runtime. Ensures the local data directory and a dev
// session token exist, then execs the runtime entrypoint through tsx (no build step). The
// generated token is local-only (gitignored under runtime-data/) and is never committed.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(repoRoot, "runtime-data");
const tokenPath = join(dataDir, "dev-token");
const databasePath = join(dataDir, "v31m4.sqlite");

mkdirSync(dataDir, { recursive: true });

let token;
if (existsSync(tokenPath)) {
  token = readFileSync(tokenPath, "utf8").trim();
}
if (token === undefined || token.length < 16) {
  token = randomBytes(24).toString("hex");
  writeFileSync(tokenPath, token, { mode: 0o600 });
}

const host = process.env.V31M4_HOST ?? "127.0.0.1";
const port = process.env.V31M4_PORT ?? "8787";

process.stderr.write(
  `[dev] data dir:       ${dataDir}\n` +
    `[dev] database:       ${databasePath}\n` +
    `[dev] auth token:     ${token}\n` +
    `[dev] operator URL:   http://${host}:${port}/\n` +
    `[dev] health check:   curl http://${host}:${port}/health\n` +
    `[dev] authenticated:  curl -H "authorization: Bearer ${token}" http://${host}:${port}/records/<type>/<id>\n`,
);

const child = spawn(
  process.execPath,
  ["--import", "tsx/esm", join(repoRoot, "apps/runtime/src/main.ts")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      V31M4_HOST: host,
      V31M4_PORT: port,
      V31M4_AUTH_TOKEN: token,
      V31M4_DATABASE: databasePath,
      V31M4_ACTOR_ID: process.env.V31M4_ACTOR_ID ?? "operator",
    },
  },
);
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal !== null ? 1 : 0);
});
