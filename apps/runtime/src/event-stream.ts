import { randomUUID } from "node:crypto";
import type { DomainEvent } from "@v31m4/domain";
import type { EventReplayStore, SequencedEvent } from "@v31m4/infrastructure";

/** A frame delivered to a subscriber sink. */
export type EventStreamFrame =
  | { readonly kind: "event"; readonly sequence: number; readonly event: DomainEvent }
  | { readonly kind: "refresh_required"; readonly oldest: number; readonly latest: number }
  | { readonly kind: "disconnect"; readonly resumeAfter: number; readonly reason: string };

/** Transport binding: a sink receives ordered frames and may apply backpressure by returning a promise. */
export interface EventSink {
  deliver(frame: EventStreamFrame): void | Promise<void>;
}

export interface EventStreamOptions {
  /** Maximum events buffered for one slow subscriber before it is disconnected. */
  readonly maxQueue?: number;
  /** Durable replay batch size. */
  readonly batchSize?: number;
}

export interface StreamSubscription {
  readonly id: string;
  /** Resolves once the replay boundary is handed off to live delivery, or the subscription terminates. */
  readonly ready: Promise<void>;
  closed(): boolean;
  /** The last durable sequence delivered; a reconnecting client resumes strictly after it. */
  resumeCursor(): number;
  close(): void;
}

const DEFAULT_MAX_QUEUE = 1024;
const DEFAULT_BATCH_SIZE = 512;

class Subscription implements StreamSubscription {
  readonly id = `subscription-${randomUUID()}`;
  readonly ready: Promise<void>;
  #resolveReady!: () => void;
  #closed = false;
  #replayDone = false;
  #draining = false;
  /** Sequences at or below the divider belong to replay; strictly above it are live. */
  #divider = 0;
  #lastDelivered = 0;
  readonly #live: SequencedEvent[] = [];

  constructor(
    private readonly coordinator: EventStreamCoordinator,
    private readonly replay: EventReplayStore,
    private readonly afterSequence: number,
    private readonly sink: EventSink,
    private readonly maxQueue: number,
    private readonly batchSize: number,
  ) {
    this.ready = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });
    this.#lastDelivered = afterSequence;
    void this.#start();
  }

  closed(): boolean {
    return this.#closed;
  }

  resumeCursor(): number {
    return this.#lastDelivered;
  }

  close(): void {
    this.#terminate(this.#lastDelivered, "closed");
  }

  /** Called synchronously by the coordinator after an event commits; only committed events reach here. */
  enqueueLive(event: SequencedEvent): void {
    if (this.#closed) return;
    if (event.sequence <= this.#divider) return; // replay already covers this sequence
    if (event.sequence <= this.#lastDelivered) return; // already delivered
    this.#live.push(event);
    if (this.#live.length > this.maxQueue) {
      this.#disconnect();
      return;
    }
    if (this.#replayDone) void this.#drain();
  }

  async #start(): Promise<void> {
    const bounds = this.replay.bounds();
    if (bounds.latest === null || this.afterSequence >= bounds.latest) {
      // Empty log or already caught up: no replay, deliver only strictly-newer live events.
      this.#divider = this.afterSequence;
      this.#replayDone = true;
      this.#resolveReady();
      void this.#drain();
      return;
    }
    if (bounds.oldest !== null && this.afterSequence + 1 < bounds.oldest) {
      // The cursor predates retained history; never silently resume from a newer point.
      await this.#safeDeliver({
        kind: "refresh_required",
        oldest: bounds.oldest,
        latest: bounds.latest,
      });
      this.#terminate(this.afterSequence, "refresh_required");
      return;
    }
    const boundary = bounds.latest;
    this.#divider = boundary;
    try {
      let cursor = this.afterSequence;
      while (cursor < boundary && !this.#closed) {
        const batch = this.replay.readAfter(cursor, this.batchSize);
        if (batch.length === 0) break;
        for (const entry of batch) {
          if (this.#closed) return;
          await this.#safeDeliver({ kind: "event", sequence: entry.sequence, event: entry.event });
          if (this.#closed) return;
          cursor = entry.sequence;
          this.#lastDelivered = entry.sequence;
        }
      }
    } catch {
      // An internal gap (or any read integrity failure) makes replay ambiguous: refuse it and
      // tell the client to reload authoritative state instead of skipping the missing sequence.
      const current = this.replay.bounds();
      if (current.oldest !== null && current.latest !== null) {
        await this.#safeDeliver({
          kind: "refresh_required",
          oldest: current.oldest,
          latest: current.latest,
        });
      }
      this.#terminate(this.#lastDelivered, "internal_gap");
      return;
    }
    if (this.#closed) return;
    this.#replayDone = true;
    this.#resolveReady();
    void this.#drain();
  }

  async #drain(): Promise<void> {
    if (this.#draining || this.#closed || !this.#replayDone) return;
    this.#draining = true;
    try {
      while (this.#live.length > 0 && !this.#closed) {
        const next = this.#live[0];
        if (next === undefined) break;
        await this.#safeDeliver({ kind: "event", sequence: next.sequence, event: next.event });
        if (this.#closed) break;
        this.#live.shift();
        this.#lastDelivered = next.sequence;
      }
    } finally {
      this.#draining = false;
    }
  }

  #disconnect(): void {
    if (this.#closed) return;
    const resumeAfter = this.#lastDelivered;
    this.#terminate(resumeAfter, "slow_consumer");
    // Best-effort close frame; a truly saturated transport may never receive it, which is why
    // the resumable cursor is authoritative for reconnection.
    void this.#safeDeliver({ kind: "disconnect", resumeAfter, reason: "slow_consumer" });
  }

  async #safeDeliver(frame: EventStreamFrame): Promise<void> {
    try {
      await this.sink.deliver(frame);
    } catch {
      // A failed transport write is a dropped client; stop delivering to it.
      this.#terminate(this.#lastDelivered, "sink_error");
    }
  }

  #terminate(resumeAfter: number, _reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lastDelivered = resumeAfter;
    this.coordinator.remove(this);
    this.#resolveReady();
  }
}

/**
 * Coordinates resumable subscriptions over the durable committed-event log.
 *
 * A subscription fixes its replay boundary at the latest committed sequence, replays strictly
 * ordered events after the caller's cursor up to that boundary, then hands off to live delivery
 * for sequences beyond it — so replay and live never race and never duplicate. Live delivery is
 * bounded per subscriber; a consumer that cannot keep up is disconnected with an explicit
 * resumable cursor rather than growing memory without limit. A cursor that predates retained
 * history, or a detected internal gap, yields `refresh_required` instead of an ambiguous resume.
 */
export class EventStreamCoordinator {
  readonly #subscriptions = new Set<Subscription>();
  readonly #maxQueue: number;
  readonly #batchSize: number;

  constructor(
    private readonly replay: EventReplayStore,
    options: EventStreamOptions = {},
  ) {
    this.#maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /** Fan a freshly committed event out to every live subscriber. Call only after the commit. */
  publish(event: SequencedEvent): void {
    for (const subscription of this.#subscriptions) subscription.enqueueLive(event);
  }

  subscribe(afterSequence: number, sink: EventSink): StreamSubscription {
    const subscription = new Subscription(
      this,
      this.replay,
      afterSequence,
      sink,
      this.#maxQueue,
      this.#batchSize,
    );
    this.#subscriptions.add(subscription);
    return subscription;
  }

  remove(subscription: Subscription): void {
    this.#subscriptions.delete(subscription);
  }

  closeAll(): void {
    for (const subscription of [...this.#subscriptions]) subscription.close();
  }

  activeCount(): number {
    return this.#subscriptions.size;
  }
}
