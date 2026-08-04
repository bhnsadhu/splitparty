import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecoveryMatchesEvent,
  isCreateEventPayload,
  isPaymentPayload,
  paymentRecoveryMatchesSettlement,
} from "../lib/recovery.ts";
import type { EventState, SettlementPub } from "../lib/types.ts";

const event: EventState["event"] = {
  id: "event-1",
  name: "Lake House",
  code: "ABCDE",
  currency: "USD",
};

const settlement: SettlementPub = {
  id: "settlement-1",
  from: "member-1",
  to: "member-2",
  amountCents: 1_234,
  status: "pending",
  createdAt: "2026-08-04T12:00:00.000Z",
  resolvedAt: null,
};

test("create recovery matches the deliberately deleted party after server normalization", () => {
  const payload = { eventName: "  Lake   House ", displayName: " Host  Name " };
  assert.equal(isCreateEventPayload(payload), true);
  assert.equal(createRecoveryMatchesEvent(payload, event, "Host Name"), true);
  assert.equal(
    createRecoveryMatchesEvent(payload, { ...event, name: "Other Party" }, "Host Name"),
    false,
  );
});

test("payment recovery matches only the cancelled destination and amount", () => {
  const payload = { to: "member-2", amount: "12.34", amountCents: 1_234 };
  assert.equal(isPaymentPayload(payload), true);
  assert.equal(paymentRecoveryMatchesSettlement(payload, settlement), true);
  assert.equal(
    paymentRecoveryMatchesSettlement(
      payload,
      { ...settlement, amountCents: 1_235 },
    ),
    false,
  );
  assert.equal(
    paymentRecoveryMatchesSettlement(payload, { ...settlement, to: "member-3" }),
    false,
  );
});
