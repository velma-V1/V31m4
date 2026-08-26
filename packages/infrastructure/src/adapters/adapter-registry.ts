export interface AdapterRegistration {
  readonly id: string;
  readonly protocolVersion: string;
  readonly capabilities: readonly string[];
}

export interface AdapterRegistryOptions {
  /**
   * Exact adapter protocol versions this runtime speaks, supplied by the composition root from
   * the contracts package. Infrastructure enforces the closed set without owning it, so there
   * is no second copy of the protocol version list.
   */
  readonly supportedProtocolVersions: readonly string[];
}

export class AdapterRegistry {
  readonly #adapters = new Map<string, AdapterRegistration>();
  readonly #supportedProtocolVersions: ReadonlySet<string>;

  constructor(options: AdapterRegistryOptions) {
    if (options.supportedProtocolVersions.length === 0) {
      throw new Error("An adapter registry must declare at least one supported protocol version");
    }
    this.#supportedProtocolVersions = new Set(options.supportedProtocolVersions);
  }

  register(adapter: AdapterRegistration): void {
    if (this.#adapters.has(adapter.id))
      throw new Error(`Adapter already registered: ${adapter.id}`);
    // Exact-version compatibility: an unsupported version is rejected, never coerced to the
    // nearest known one. See docs/contract-versioning.md.
    if (!this.#supportedProtocolVersions.has(adapter.protocolVersion)) {
      throw new Error(
        `Unsupported adapter protocol version: ${adapter.protocolVersion} (supported: ${[...this.#supportedProtocolVersions].join(", ")})`,
      );
    }
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
