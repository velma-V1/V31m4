import { randomUUID } from "node:crypto";

interface Lease {
  readonly value: string;
  readonly expiresAt: number;
}

export class LeasedSecretStore {
  readonly #secrets = new Map<string, string>();
  readonly #leases = new Map<string, Lease>();

  set(name: string, value: string): void {
    if (!name || !value) throw new Error("Secret name and value are required");
    this.#secrets.set(name, value);
  }

  lease(name: string, ttlMs: number, now = Date.now()): string {
    const value = this.#secrets.get(name);
    if (!value || !Number.isSafeInteger(ttlMs) || ttlMs <= 0)
      throw new Error("Invalid secret lease");
    const token = randomUUID();
    this.#leases.set(token, { value, expiresAt: now + ttlMs });
    return token;
  }

  redeem(token: string, now = Date.now()): string {
    const lease = this.#leases.get(token);
    this.#leases.delete(token);
    if (!lease || lease.expiresAt <= now) throw new Error("Secret lease is invalid or expired");
    return lease.value;
  }

  valuesForRedaction(): readonly string[] {
    return [...this.#secrets.values()];
  }
}
