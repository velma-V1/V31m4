import { createDomainEvent, type DomainEvent } from "@v31m4/domain";
import {
  EventReplayStore,
  type SequencedEvent,
  SqliteOutbox,
  type SqliteRuntimeDatabase,
} from "@v31m4/infrastructure";
import { describe, expect, it } from "vitest";
import {
  type EventSink,
  EventStreamCoordinator,
  type EventStreamFrame,
} from "../src/event-stream.js";
import { context, runtimeDatabase } from "./fixtures.js";

function event(id: string): DomainEvent {
  return createDomainEvent({
    id,
    type: "job.started",
    aggregateType: "job",
    aggregateId: "job-1",
    occurredAt: context.startedAt,
    payload: {},
    metadata: {},
  });
}

function sequenced(sequence: number): SequencedEvent {
  return { sequence, event: event(`event-${sequence}`) };
}

async function seed(db: SqliteRuntimeDatabase, count: number): Promise<void> {
  const outbox = new SqliteOutbox(db);
  await db.unitOfWork.execute(context, async (transaction) => {
    for (let index = 1; index <= count; index += 1) {
      await outbox.append(event(`event-${index}`), transaction);
    }
  });
}

function recordingSink(): EventSink & { readonly frames: EventStreamFrame[] } {
  const frames: EventStreamFrame[] = [];
  return { frames, deliver: (frame) => void frames.push(frame) };
}

function deliveredSequences(frames: readonly EventStreamFrame[]): number[] {
  return frames.filter((frame) => frame.kind === "event").map((frame) => frame.sequence);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

describe("EventStreamCoordinator", () => {
  it("replays strictly ordered events after the cursor, then delivers live events", async () => {
    const db = runtimeDatabase();
    await seed(db, 5);
    const coordinator = new EventStreamCoordinator(new EventReplayStore(db));
    const sink = recordingSink();
    const subscription = coordinator.subscribe(2, sink);
    await subscription.ready;
    coordinator.publish(sequenced(6));
    await flush();
    expect(deliveredSequences(sink.frames)).toEqual([3, 4, 5, 6]);
    db.close();
  });

  it("fixes the replay boundary so live events during replay neither race nor duplicate", async () => {
    const db = runtimeDatabase();
    await seed(db, 3);
    const coordinator = new EventStreamCoordinator(new EventReplayStore(db));
    const sink = recordingSink();
    const subscription = coordinator.subscribe(0, sink);
    // A duplicate of an in-replay sequence must be dropped; a genuinely newer one must arrive once.
    coordinator.publish(sequenced(3));
    coordinator.publish(sequenced(4));
    await subscription.ready;
    await flush();
    expect(deliveredSequences(sink.frames)).toEqual([1, 2, 3, 4]);
    db.close();
  });

  it("returns refresh_required when the cursor predates retained history", async () => {
    const db = runtimeDatabase();
    await seed(db, 5);
    db.connection.prepare("DELETE FROM outbox_events WHERE sequence <= ?").run(2);
    const coordinator = new EventStreamCoordinator(new EventReplayStore(db));
    const sink = recordingSink();
    const subscription = coordinator.subscribe(1, sink);
    await subscription.ready;
    expect(sink.frames).toEqual([{ kind: "refresh_required", oldest: 3, latest: 5 }]);
    expect(subscription.closed()).toBe(true);
    db.close();
  });

  it("refuses ambiguous replay on an internal gap and signals refresh_required", async () => {
    const db = runtimeDatabase();
    await seed(db, 5);
    db.connection.prepare("DELETE FROM outbox_events WHERE sequence = ?").run(3);
    const coordinator = new EventStreamCoordinator(new EventReplayStore(db));
    const sink = recordingSink();
    const subscription = coordinator.subscribe(0, sink);
    await subscription.ready;
    expect(deliveredSequences(sink.frames)).toEqual([]);
    expect(sink.frames.some((frame) => frame.kind === "refresh_required")).toBe(true);
    expect(subscription.closed()).toBe(true);
    db.close();
  });

  it("disconnects a slow consumer with a resumable cursor once its bounded queue overflows", async () => {
    const db = runtimeDatabase();
    const coordinator = new EventStreamCoordinator(new EventReplayStore(db), { maxQueue: 2 });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const frames: EventStreamFrame[] = [];
    let eventDeliveries = 0;
    const sink: EventSink = {
      deliver(frame) {
        frames.push(frame);
        if (frame.kind === "event") {
          eventDeliveries += 1;
          if (eventDeliveries === 1) return firstGate; // stall the consumer on its first event
        }
        return undefined;
      },
    };
    const subscription = coordinator.subscribe(0, sink);
    await subscription.ready; // empty log: immediately live
    coordinator.publish(sequenced(1)); // begins delivery, stalls on the gate
    coordinator.publish(sequenced(2)); // buffered (queue length 2, within bound)
    coordinator.publish(sequenced(3)); // overflows the bound -> disconnect
    await flush();
    expect(subscription.closed()).toBe(true);
    expect(subscription.resumeCursor()).toBe(0);
    expect(frames.some((frame) => frame.kind === "disconnect" && frame.resumeAfter === 0)).toBe(
      true,
    );
    releaseFirst();
    await flush();
    db.close();
  });
});
