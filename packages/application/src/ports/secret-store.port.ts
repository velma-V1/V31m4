import type { OperationContext } from "../operation-context.js";

export interface SecretLease {
  readonly key: string;
  readonly expiresAt?: string;
  use<Result>(consumer: (secret: string) => Result | Promise<Result>): Promise<Result>;
  close(): Promise<void>;
}

export interface SecretStorePort {
  exists(key: string, context: OperationContext): Promise<boolean>;
  acquire(key: string, context: OperationContext): Promise<SecretLease>;
}
