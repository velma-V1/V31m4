export interface StructuredLog {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export class RedactedLogger {
  constructor(
    private readonly sink: (line: string) => void,
    private readonly secrets: () => readonly string[],
  ) {}

  write(entry: StructuredLog): void {
    let line = JSON.stringify(entry);
    for (const secret of this.secrets()) {
      // Skip empty secrets: replaceAll("", ...) would splice the marker between every character
      // and destroy the log line without redacting anything.
      if (secret.length === 0) continue;
      line = line.replaceAll(secret, "[REDACTED]");
    }
    this.sink(line);
  }
}
