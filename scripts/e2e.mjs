// End-to-end flow test against an explicitly configured Supabase test backend.
// Two "devices": Ana (host) and Bo (guest). Exercises create → join →
// approve → expenses → settle math → record payment → confirm.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { e2eConfig } from "./e2e-config.mjs";

const { url: URL, key: KEY } = e2eConfig();

const anaId = randomUUID();
const boId = randomUUID();
const ana = createClient(URL, KEY, { auth: { persistSession: false } });
const bo = createClient(URL, KEY, { auth: { persistSession: false } });

let failures = 0;
let cleanupEventId = null;
function check(label, cond, detail = "") {
  const ok = !!cond;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function rpc(client, deviceId, fn, args) {
  const { data, error } = await client.rpc(fn, { p_device_id: deviceId, ...args });
  if (error) throw new Error(`${fn}: ${error.message} (code ${error.code})`);
  return data;
}

async function rpcIsDenied(client, deviceId, fn, args) {
  const { error } = await client.rpc(fn, { p_device_id: deviceId, ...args });
  return Boolean(error);
}

// --- On-device ledger math, mirrored from lib/settle.ts ---
function seedFromId(id) {
  return parseInt(id.replace(/-/g, "").slice(0, 8), 16) || 0;
}
function computeLedger(members, expenses, settlements) {
  const activeIds = members.filter((m) => m.status === "active").map((m) => m.id).sort();
  const paid = new Map(), share = new Map(), sent = new Map(), recv = new Map();
  const bump = (m, k, d) => m.set(k, (m.get(k) ?? 0) + d);
  let totalSpentCents = 0;
  for (const e of expenses) {
    totalSpentCents += e.amountCents;
    bump(paid, e.paidBy, e.amountCents);
    const snapshot = Array.isArray(e.participantIds)
      ? [...new Set(e.participantIds)].sort()
      : [];
    const participants = snapshot.length ? snapshot : activeIds;
    const count = participants.length;
    if (!count) continue;
    const base = Math.floor(e.amountCents / count);
    const remainder = e.amountCents - base * count;
    const offset = seedFromId(e.id) % count;
    for (let k = 0; k < count; k++)
      bump(share, participants[(offset + k) % count], base + (k < remainder ? 1 : 0));
  }
  for (const s of settlements) {
    if (s.status !== "confirmed") continue;
    bump(sent, s.from, s.amountCents);
    bump(recv, s.to, s.amountCents);
  }
  const balances = members.map((m) => {
    const p = paid.get(m.id) ?? 0, sh = share.get(m.id) ?? 0;
    const se = sent.get(m.id) ?? 0, re = recv.get(m.id) ?? 0;
    return { memberId: m.id, paidCents: p, shareCents: sh, sentCents: se, recvCents: re, netCents: p - sh + se - re };
  });
  return { balances, totalSpentCents };
}

async function main() {
  const directRead = await ana.from("events").select("id").limit(1);
  check("anon direct table read is denied", Boolean(directRead.error));
  const helperCall = await ana.rpc("sp_check_device", { p_device_id: anaId });
  check("internal helper RPC is not exposed", Boolean(helperCall.error));

  // 1. Ana creates event
  const createRequestId = randomUUID();
  const created = await rpc(ana, anaId, "sp_create_event", {
    p_event_name: "Beach Trip", p_display_name: "Ana", p_request_id: createRequestId,
  });
  const eventId = created.eventId;
  cleanupEventId = eventId;
  check("create event", eventId && created.code, `code ${created.code}`);
  const createRetry = await rpc(ana, anaId, "sp_create_event", {
    p_event_name: "Beach Trip", p_display_name: "Ana", p_request_id: createRequestId,
  });
  check("create retry is idempotent", createRetry.eventId === eventId && createRetry.code === created.code);
  check(
    "create request ID rejects changed payload",
    await rpcIsDenied(ana, anaId, "sp_create_event", {
      p_event_name: "Different Trip",
      p_display_name: "Ana",
      p_request_id: createRequestId,
    }),
  );

  const outsiderState = await rpc(bo, boId, "sp_event_state", { p_event_id: eventId });
  check(
    "unrelated device cannot read event data",
    outsiderState.notMember === true && !outsiderState.event && !outsiderState.members,
  );
  check(
    "unrelated device cannot add an expense",
    await rpcIsDenied(bo, boId, "sp_add_expense", {
      p_event_id: eventId,
      p_label: "Unauthorized",
      p_amount_cents: 100,
      p_paid_by: null,
      p_request_id: randomUUID(),
    }),
  );

  // 2. Bo joins
  const joined = await rpc(bo, boId, "sp_join_event", {
    p_code: created.code, p_display_name: "Bo",
  });
  check("Bo joins → pending", joined.status === "pending");

  const pendingHome = await rpc(bo, boId, "sp_my_events", {});
  check(
    "pending member sees no aggregates",
    pendingHome.length === 1 &&
      pendingHome[0].activeCount === 0 &&
      pendingHome[0].totalSpentCents === 0,
  );
  const pendingState = await rpc(bo, boId, "sp_event_state", { p_event_id: eventId });
  check(
    "pending member sees only restricted state",
    pendingState.restricted === true &&
      !pendingState.members &&
      !pendingState.expenses &&
      !pendingState.settlements,
  );
  check(
    "pending member cannot approve themself",
    await rpcIsDenied(bo, boId, "sp_member_action", {
      p_event_id: eventId,
      p_member_id: pendingState.me.memberId,
      p_action: "approve",
    }),
  );
  check(
    "pending member cannot delete the event",
    await rpcIsDenied(bo, boId, "sp_delete_event", { p_event_id: eventId }),
  );

  // 3. Ana sees Bo at the door and approves
  let st = await rpc(ana, anaId, "sp_event_state", { p_event_id: eventId });
  const boMember = st.members.find((m) => m.name === "Bo");
  check("Bo shows as pending to host", boMember && boMember.status === "pending");
  await rpc(ana, anaId, "sp_member_action", {
    p_event_id: eventId, p_member_id: boMember.id, p_action: "approve",
  });

  st = await rpc(ana, anaId, "sp_event_state", { p_event_id: eventId });
  const anaMember = st.members.find((m) => m.name === "Ana");
  const bo2 = st.members.find((m) => m.name === "Bo");
  check("Bo now active", bo2.status === "active");

  // 4. Log expenses. Ana pays $40.00, Bo pays $15.01 (odd cents → remainder split)
  const pizzaRequestId = randomUUID();
  const pizza = await rpc(ana, anaId, "sp_add_expense", {
    p_event_id: eventId, p_label: "Pizza", p_amount_cents: 4000, p_paid_by: anaMember.id,
    p_request_id: pizzaRequestId,
  });
  const pizzaRetry = await rpc(ana, anaId, "sp_add_expense", {
    p_event_id: eventId, p_label: "Pizza", p_amount_cents: 4000, p_paid_by: anaMember.id,
    p_request_id: pizzaRequestId,
  });
  check("expense retry is idempotent", pizzaRetry.id === pizza.id);
  check(
    "expense request ID rejects changed payload",
    await rpcIsDenied(ana, anaId, "sp_add_expense", {
      p_event_id: eventId,
      p_label: "Different Pizza",
      p_amount_cents: 4000,
      p_paid_by: anaMember.id,
      p_request_id: pizzaRequestId,
    }),
  );
  await rpc(bo, boId, "sp_add_expense", {
    p_event_id: eventId, p_label: "Drinks", p_amount_cents: 1501, p_paid_by: bo2.id,
    p_request_id: randomUUID(),
  });

  st = await rpc(ana, anaId, "sp_event_state", { p_event_id: eventId });
  check("two expenses logged", st.expenses.length === 2);

  // 5. Verify settle math
  const members = st.members.map((m) => ({ id: m.id, status: m.status }));
  const expenses = st.expenses.map((e) => ({ id: e.id, paidBy: e.paidBy, amountCents: e.amountCents, participantIds: e.participantIds }));
  const ledger = computeLedger(members, expenses, []);
  const total = 4000 + 1501;
  check("total spent", ledger.totalSpentCents === total, `${total}`);
  const sumShares = ledger.balances.reduce((s, b) => s + b.shareCents, 0);
  check("shares sum to total (no lost pennies)", sumShares === total, `${sumShares}`);
  const sumNet = ledger.balances.reduce((s, b) => s + b.netCents, 0);
  check("nets sum to zero", sumNet === 0, `${sumNet}`);
  const anaBal = ledger.balances.find((b) => b.memberId === anaMember.id);
  const boBal = ledger.balances.find((b) => b.memberId === bo2.id);
  // Ana paid 4000, Bo paid 1501, total 5501 split 2 ways = 2750/2751.
  // Ana net = paid - share, Bo net = -Ana net.
  check("Ana net + Bo net = 0", anaBal.netCents + boBal.netCents === 0);
  check("Ana is owed (net>0)", anaBal.netCents > 0, `Ana net ${anaBal.netCents}, Bo net ${boBal.netCents}`);
  // Bo owes Ana; expected ~ (5501/2 rounding) ≈ 1249 or 1250
  const boOwes = -boBal.netCents;
  check("Bo owes Ana a sane amount", boOwes === 1249 || boOwes === 1250, `${boOwes}`);

  // 6. Bo records a payment to Ana for what the plan says
  const settlementRequestId = randomUUID();
  const sett = await rpc(bo, boId, "sp_create_settlement", {
    p_event_id: eventId, p_to_member: anaMember.id, p_amount_cents: boOwes,
    p_request_id: settlementRequestId,
  });
  check("Bo records payment (pending)", sett.ok && sett.id);
  const settlementRetry = await rpc(bo, boId, "sp_create_settlement", {
    p_event_id: eventId, p_to_member: anaMember.id, p_amount_cents: boOwes,
    p_request_id: settlementRequestId,
  });
  check("payment retry is idempotent", settlementRetry.id === sett.id);
  check(
    "payment request ID rejects changed payload",
    await rpcIsDenied(bo, boId, "sp_create_settlement", {
      p_event_id: eventId,
      p_to_member: anaMember.id,
      p_amount_cents: boOwes + 1,
      p_request_id: settlementRequestId,
    }),
  );
  check(
    "a second pending payment for the same pair is rejected",
    await rpcIsDenied(bo, boId, "sp_create_settlement", {
      p_event_id: eventId,
      p_to_member: anaMember.id,
      p_amount_cents: boOwes,
      p_request_id: randomUUID(),
    }),
  );

  st = await rpc(bo, boId, "sp_event_state", { p_event_id: eventId });
  let sRow = st.settlements.find((s) => s.id === sett.id);
  check("settlement pending, not yet in balances", sRow.status === "pending");
  const preConfirm = computeLedger(members, expenses, st.settlements);
  check("pending settlement does NOT move balances",
    preConfirm.balances.find((b) => b.memberId === bo2.id).netCents === boBal.netCents);

  // 7. Ana confirms
  const conf = await rpc(ana, anaId, "sp_resolve_settlement", {
    p_event_id: eventId, p_settlement_id: sett.id, p_action: "confirm",
  });
  check("Ana confirms payment", conf.ok);

  st = await rpc(ana, anaId, "sp_event_state", { p_event_id: eventId });
  sRow = st.settlements.find((s) => s.id === sett.id);
  check("settlement now confirmed", sRow.status === "confirmed");

  const finalLedger = computeLedger(members, st.expenses.map((e) => ({ id: e.id, paidBy: e.paidBy, amountCents: e.amountCents, participantIds: e.participantIds })), st.settlements);
  const finalAna = finalLedger.balances.find((b) => b.memberId === anaMember.id);
  const finalBo = finalLedger.balances.find((b) => b.memberId === bo2.id);
  check("Bo square after confirmed payment", finalBo.netCents === 0, `Bo net ${finalBo.netCents}`);
  check("Ana square after confirmed payment", finalAna.netCents === 0, `Ana net ${finalAna.netCents}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  return failures;
}

async function cleanup() {
  if (!cleanupEventId) return;
  const eventId = cleanupEventId;
  await rpc(ana, anaId, "sp_delete_event", { p_event_id: eventId });
  cleanupEventId = null;
  console.log("\n🧹 deleted the temporary event");
}

main()
  .then(async (count) => {
    await cleanup();
    process.exitCode = count === 0 ? 0 : 1;
  })
  .catch(async (error) => {
    console.error("💥", error.message);
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("💥 cleanup failed:", cleanupError.message);
    }
    process.exitCode = 1;
  });
