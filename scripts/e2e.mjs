// End-to-end flow test against the live Supabase backend.
// Two "devices": Ana (host) and Bo (guest). Exercises create → join →
// approve → expenses → settle math → record payment → confirm.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = "https://chkymwkafaljedtlrqoa.supabase.co";
const KEY = "sb_publishable_oOhF3ge6yDhOEjn-JPrafg_8Ghf3B0q";

const anaId = randomUUID();
const boId = randomUUID();
const ana = createClient(URL, KEY, { auth: { persistSession: false } });
const bo = createClient(URL, KEY, { auth: { persistSession: false } });

let failures = 0;
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

// --- On-device ledger math, mirrored from lib/settle.ts ---
function seedFromId(id) {
  return parseInt(id.replace(/-/g, "").slice(0, 8), 16) || 0;
}
function computeLedger(members, expenses, settlements) {
  const activeIds = members.filter((m) => m.status === "active").map((m) => m.id).sort();
  const n = activeIds.length;
  const paid = new Map(), share = new Map(), sent = new Map(), recv = new Map();
  const bump = (m, k, d) => m.set(k, (m.get(k) ?? 0) + d);
  let totalSpentCents = 0;
  for (const e of expenses) {
    totalSpentCents += e.amountCents;
    bump(paid, e.paidBy, e.amountCents);
    if (n === 0) continue;
    const base = Math.floor(e.amountCents / n);
    const remainder = e.amountCents - base * n;
    const offset = seedFromId(e.id) % n;
    for (let k = 0; k < n; k++)
      bump(share, activeIds[(offset + k) % n], base + (k < remainder ? 1 : 0));
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
  // 1. Ana creates event
  const created = await rpc(ana, anaId, "sp_create_event", {
    p_event_name: "Beach Trip", p_display_name: "Ana",
  });
  const eventId = created.eventId;
  check("create event", eventId && created.code, `code ${created.code}`);

  // 2. Bo joins
  const joined = await rpc(bo, boId, "sp_join_event", {
    p_code: created.code, p_display_name: "Bo",
  });
  check("Bo joins → pending", joined.status === "pending");

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
  await rpc(ana, anaId, "sp_add_expense", {
    p_event_id: eventId, p_label: "Pizza", p_amount_cents: 4000, p_paid_by: anaMember.id,
  });
  await rpc(bo, boId, "sp_add_expense", {
    p_event_id: eventId, p_label: "Drinks", p_amount_cents: 1501, p_paid_by: bo2.id,
  });

  st = await rpc(ana, anaId, "sp_event_state", { p_event_id: eventId });
  check("two expenses logged", st.expenses.length === 2);

  // 5. Verify settle math
  const members = st.members.map((m) => ({ id: m.id, status: m.status }));
  const expenses = st.expenses.map((e) => ({ id: e.id, paidBy: e.paidBy, amountCents: e.amountCents }));
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
  const sett = await rpc(bo, boId, "sp_create_settlement", {
    p_event_id: eventId, p_to_member: anaMember.id, p_amount_cents: boOwes,
  });
  check("Bo records payment (pending)", sett.ok && sett.id);

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

  const finalLedger = computeLedger(members, st.expenses.map((e) => ({ id: e.id, paidBy: e.paidBy, amountCents: e.amountCents })), st.settlements);
  const finalAna = finalLedger.balances.find((b) => b.memberId === anaMember.id);
  const finalBo = finalLedger.balances.find((b) => b.memberId === bo2.id);
  check("Bo square after confirmed payment", finalBo.netCents === 0, `Bo net ${finalBo.netCents}`);
  check("Ana square after confirmed payment", finalAna.netCents === 0, `Ana net ${finalAna.netCents}`);

  // Cleanup
  await rpc(ana, anaId, "sp_delete_my_data", {});
  await rpc(bo, boId, "sp_delete_my_data", {});
  console.log("\n🧹 cleaned up test data");

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("💥", e.message); process.exit(1); });
