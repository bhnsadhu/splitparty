import type { EventState, SettlementPub } from "./types";

export type CreateEventPayload = {
  eventName: string;
  displayName: string;
};

export type PaymentPayload = {
  to: string;
  amount: string;
  amountCents: number;
};

export function isCreateEventPayload(value: unknown): value is CreateEventPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.eventName === "string" &&
    payload.eventName.length <= 60 &&
    typeof payload.displayName === "string" &&
    payload.displayName.length <= 40
  );
}

export function isPaymentPayload(value: unknown): value is PaymentPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.to === "string" &&
    payload.to.length > 0 &&
    typeof payload.amount === "string" &&
    payload.amount.length <= 32 &&
    typeof payload.amountCents === "number" &&
    Number.isSafeInteger(payload.amountCents) &&
    payload.amountCents > 0 &&
    payload.amountCents <= 100_000_000
  );
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/** True when a recovered create request owns the party being deleted. */
export function createRecoveryMatchesEvent(
  payload: CreateEventPayload,
  event: EventState["event"],
  hostDisplayName: string,
): boolean {
  return (
    normalizedName(payload.eventName) === event.name &&
    normalizedName(payload.displayName) === hostDisplayName
  );
}

/** True when a recovered payment could recreate the settlement being cancelled. */
export function paymentRecoveryMatchesSettlement(
  payload: PaymentPayload,
  settlement: SettlementPub,
): boolean {
  return payload.to === settlement.to && payload.amountCents === settlement.amountCents;
}
