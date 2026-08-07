export interface ProcessResourceReading {
  readonly pid: number;
  readonly sampledAt: number;
  readonly memoryBytes: number;
}

export class ProcessResourceMonitor {
  read(pid: number, now = Date.now()): ProcessResourceReading {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid process identifier");
    return {
      pid,
      sampledAt: now,
      memoryBytes: pid === process.pid ? process.memoryUsage().rss : 0,
    };
  }
}
