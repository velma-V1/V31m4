import type {
  AvatarId,
  AvatarState,
  CapabilityId,
  CapabilityProfile,
  PromotionRecord,
} from "@v31m4/domain";
import type { OperationContext } from "../operation-context.js";
import type { PortPage, PortPageRequest, Versioned, WriteCondition } from "../port-types.js";
import type { UnitOfWorkTransaction } from "./unit-of-work.port.js";

export interface CapabilityRepositoryPort {
  getProfile(
    id: CapabilityId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<CapabilityProfile> | null>;
  listProfiles(
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<CapabilityProfile>>>;
  saveProfile(
    profile: CapabilityProfile,
    condition: WriteCondition,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<CapabilityProfile>>;
  appendPromotion(
    record: PromotionRecord,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<PromotionRecord>>;
  listPromotions(
    capabilityId: CapabilityId,
    request: PortPageRequest,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<PortPage<Versioned<PromotionRecord>>>;
  getAvatar(
    id: AvatarId,
    context: OperationContext,
    transaction?: UnitOfWorkTransaction,
  ): Promise<Versioned<AvatarState> | null>;
  saveAvatar(
    state: AvatarState,
    condition: WriteCondition,
    context: OperationContext,
    transaction: UnitOfWorkTransaction,
  ): Promise<Versioned<AvatarState>>;
}
