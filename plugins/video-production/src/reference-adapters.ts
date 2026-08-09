import type {
  AssemblyAdapter,
  GeneratedShot,
  ProductionRecord,
  ProductionStore,
  QcReport,
  RenderOutput,
  ShotCache,
  ShotGenerationAdapter,
  ShotSpec,
  VisionQcAdapter,
} from "./contracts.js";
import { contentHash } from "./contracts.js";

/**
 * Deterministic reference generator. It performs no real rendering — it derives a stable content
 * reference from the (possibly corrected) shot spec — so orchestration, caching, and recovery are
 * fully verifiable without a generation model or GPU. A production adapter replaces it behind the
 * same interface.
 */
export class ReferenceShotGenerationAdapter implements ShotGenerationAdapter {
  public generateCalls = 0;
  async generate(spec: ShotSpec, attempt: number): Promise<GeneratedShot> {
    this.generateCalls += 1;
    const descriptor = contentHash({ spec, kind: "shot-descriptor" });
    return Object.freeze({
      shotId: spec.shotId,
      attempt,
      outputRef: contentHash({ descriptor, shotId: spec.shotId }),
      descriptor,
    });
  }
}

/** Deterministic reference QC: a shot fails while its spec still carries an unrepaired `defect`. */
export class ReferenceVisionQcAdapter implements VisionQcAdapter {
  async inspect(_shot: GeneratedShot, spec: ShotSpec): Promise<QcReport> {
    if (spec.defect !== undefined) {
      return Object.freeze({
        passed: false,
        findings: Object.freeze([{ kind: "defect", detail: spec.defect }]),
      });
    }
    return Object.freeze({ passed: true, findings: Object.freeze([]) });
  }
}

/** Deterministic reference assembly: a stable output reference and checksum over the accepted shots. */
export class ReferenceAssemblyAdapter implements AssemblyAdapter {
  public assembleCalls = 0;
  async assemble(productionId: string, shots: readonly GeneratedShot[]): Promise<RenderOutput> {
    this.assembleCalls += 1;
    const shotRefs = shots.map((shot) => shot.outputRef);
    return Object.freeze({
      outputRef: contentHash({ productionId, shotRefs, kind: "final-render" }),
      checksum: contentHash({ shotRefs, kind: "checksum" }),
      shotRefs: Object.freeze(shotRefs),
    });
  }
}

export class InMemoryProductionStore implements ProductionStore {
  readonly #records = new Map<string, ProductionRecord>();
  async load(productionId: string): Promise<ProductionRecord | null> {
    return this.#records.get(productionId) ?? null;
  }
  async save(record: ProductionRecord): Promise<void> {
    // Store a frozen deep copy so later in-memory mutations cannot corrupt a checkpoint.
    this.#records.set(record.productionId, JSON.parse(JSON.stringify(record)) as ProductionRecord);
  }
}

export class InMemoryShotCache implements ShotCache {
  readonly #shots = new Map<string, GeneratedShot>();
  get(outputRef: string): GeneratedShot | undefined {
    return this.#shots.get(outputRef);
  }
  put(shot: GeneratedShot): void {
    this.#shots.set(shot.outputRef, shot);
  }
}
