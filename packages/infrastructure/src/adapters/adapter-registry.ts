export interface AdapterRegistration {
  readonly id: string;
  readonly protocolVersion: string;
  readonly capabilities: readonly string[];
}

export class AdapterRegistry {
  readonly #adapters = new Map<string, AdapterRegistration>();

  register(adapter: AdapterRegistration): void {
    if (this.#adapters.has(adapter.id))
      throw new Error(`Adapter already registered: ${adapter.id}`);
    if (new Set(adapter.capabilities).size !== adapter.capabilities.length) {
      throw new Error("Adapter capabilities must be unique");
    }
    this.#adapters.set(
      adapter.id,
      Object.freeze({ ...adapter, capabilities: [...adapter.capabilities] }),
    );
  }

  get(id: string): AdapterRegistration | undefined {
    return this.#adapters.get(id);
  }

  unregister(id: string): void {
    this.#adapters.delete(id);
  }
}

export class RestartBudget {
  readonly #attempts: number[] = [];
  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {}

  consume(now = Date.now()): boolean {
    while (this.#attempts[0] !== undefined && this.#attempts[0] <= now - this.windowMs) {
      this.#attempts.shift();
    }
    if (this.#attempts.length >= this.maximum) return false;
    this.#attempts.push(now);
    return true;
  }
}
