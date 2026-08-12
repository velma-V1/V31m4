import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  ApplicationError,
  type ApplicationJsonValue,
  isApplicationJsonValue,
} from "@v31m4/application";
import type { RuntimeComposition } from "../composition-root.js";
import type { EventStreamFrame } from "../event-stream.js";
import { mapErrorToHttp } from "./error-mapper.js";

// Loaded once at server creation: the operator interface is a single static file with no build
// step (plain HTML/CSS/JS, no framework, no external requests), served unauthenticated like
// /health — it is the smallest maintainable local-first UI compatible with this runtime's
// existing HTTP+SSE surface, not a parallel dashboard architecture.
const OPERATOR_UI_HTML = readFileSync(join(import.meta.dirname, "../../public/index.html"), "utf8");

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

function respondHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  response.end(html);
}

function readJsonBody(request: IncomingMessage, limitBytes: number): Promise<ApplicationJsonValue> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    request.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > limitBytes) {
        // Stop buffering but keep the connection readable so the mapped error still reaches the
        // client; destroying the socket here would surface as an opaque network failure instead.
        overflowed = true;
        request.resume();
        reject(new ApplicationError("RESOURCE_EXHAUSTED", "Request body exceeds the limit."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        resolve({});
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(
          new ApplicationError("INVALID_APPLICATION_INPUT", "Request body is not valid JSON."),
        );
        return;
      }
      if (!isApplicationJsonValue(parsed)) {
        reject(
          new ApplicationError("INVALID_APPLICATION_INPUT", "Request body must be safe JSON."),
        );
        return;
      }
      resolve(parsed);
    });
    request.on("error", reject);
  });
}

function requireHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApplicationError("INVALID_APPLICATION_INPUT", `Missing required header '${name}'.`);
  }
  return value;
}

function streamEvents(
  composition: RuntimeComposition,
  request: IncomingMessage,
  response: ServerResponse,
  afterSequence: number,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.flushHeaders();
  const subscription = composition.coordinator.subscribe(afterSequence, {
    deliver(frame: EventStreamFrame) {
      const idLine = frame.kind === "event" ? `id: ${frame.sequence}\n` : "";
      const chunk = `${idLine}event: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`;
      return new Promise<void>((resolve, reject) => {
        if (frame.kind !== "event") {
          // A terminal frame ends the stream; the client reconnects with the resumable cursor.
          response.write(chunk, () => response.end());
          resolve();
          return;
        }
        let settled = false;
        const cleanup = (): void => {
          response.removeListener("drain", onDrain);
          response.removeListener("close", onClose);
        };
        const onDrain = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const onClose = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          // A disconnect while awaiting backpressure must settle this promise so the coordinator
          // releases the subscription instead of parking forever on a "drain" that never fires.
          reject(
            new ApplicationError("DEPENDENCY_UNAVAILABLE", "Event stream client disconnected."),
          );
        };
        const flushed = response.write(chunk, (error) => {
          if (error && !settled) {
            settled = true;
            cleanup();
            reject(error);
          }
        });
        if (flushed) {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        response.once("drain", onDrain);
        response.once("close", onClose);
      });
    },
  });
  request.on("close", () => subscription.close());
}

/**
 * Builds the local runtime HTTP surface. Routes only authenticate, translate transport to the
 * runtime service, and map errors; all authoritative behavior lives behind the service and the
 * command executor. Commands are idempotency-keyed; the event route is a resumable SSE stream.
 */
export function createRuntimeServer(composition: RuntimeComposition): Server {
  const { authenticator, service, config } = composition;
  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      const mapped = mapErrorToHttp(error);
      if (!response.headersSent) respondJson(response, mapped.status, mapped.body);
      else response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

    if (method === "GET" && url.pathname === "/") {
      respondHtml(response, OPERATOR_UI_HTML);
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      respondJson(response, 200, {
        status: "ok",
        latestSequence: composition.recoverOnStartup().latestSequence,
        subscriptions: composition.coordinator.activeCount(),
      });
      return;
    }

    const principal = authenticator.authenticate(request.headers.authorization);
    const identity = {
      requestId: `req-${randomUUID()}`,
      now: new Date().toISOString(),
    };

    if (method === "POST" && segments[0] === "commands" && segments.length === 2) {
      const idempotencyKey = requireHeader(request, "idempotency-key");
      const context = authenticator.contextFor(principal, { ...identity, idempotencyKey });
      const payload = await readJsonBody(request, config.maxRequestBytes);
      const result = await service.dispatch(segments[1] as string, payload, context);
      respondJson(response, 200, { result });
      return;
    }

    if (method === "POST" && segments[0] === "queries" && segments.length === 2) {
      const context = authenticator.contextFor(principal, {
        ...identity,
        idempotencyKey: identity.requestId,
      });
      const payload = await readJsonBody(request, config.maxRequestBytes);
      const result = await service.query(segments[1] as string, payload, context);
      respondJson(response, 200, { result });
      return;
    }

    if (method === "GET" && segments[0] === "records" && segments.length === 3) {
      const record = await service.getRecord(segments[1] as string, segments[2] as string);
      respondJson(response, 200, { record });
      return;
    }

    if (method === "GET" && url.pathname === "/events") {
      const rawCursor =
        url.searchParams.get("afterSequence") ??
        (typeof request.headers["last-event-id"] === "string"
          ? request.headers["last-event-id"]
          : "0");
      const afterSequence = Number.parseInt(rawCursor, 10);
      if (!Number.isInteger(afterSequence) || afterSequence < 0) {
        throw new ApplicationError(
          "INVALID_APPLICATION_INPUT",
          "afterSequence must be a sequence.",
        );
      }
      streamEvents(composition, request, response, afterSequence);
      return;
    }

    throw new ApplicationError("NOT_FOUND", "No such route.", {
      details: { method, path: url.pathname },
    });
  }
}
