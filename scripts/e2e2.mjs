// Edge-case flows against an explicitly configured test backend: reject,
// 3-way uneven split, and immutable history after leaving.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { e2eConfig } from "./e2e-config.mjs";

const { url: URL, key: KEY } = e2eConfig();
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } });
const A = mk(), B = mk(), C = mk();
const aId = randomUUID(), bId = randomUUID(), cId = randomUUID();

let failures = 0;
let cleanupEventId = null;
const check = (l, c, d = "") => { const ok = !!c; console.log(`${ok ? "✅" : "❌"} ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures++; };
async function rpc(cl, dev, fn, args) {
  const { data, error } = await cl.rpc(fn, { p_device_id: dev, ...args });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
function seedFromId(id) { return parseInt(id.replace(/-/g, "").slice(0, 8), 16) || 0; }
function computeLedger(members, expenses, settlements) {
  const activeIds = members.filter((m) => m.status === "active").map((m) => m.id).sort();
  const paid = new Map(), share = new Map(), sent = new Map(), recv = new Map();
  const bump = (m, k, d) => m.set(k, (m.get(k) ?? 0) + d);
  let total = 0;
  for (const e of expenses) {
    total += e.amountCents; bump(paid, e.paidBy, e.amountCents);
    const snapshot = Array.isArray(e.participantIds) ? [...new Set(e.participantIds)].sort() : [];
    const participants = snapshot.length ? snapshot : activeIds;
    const count = participants.length;
    if (count === 0) continue;
    const base = Math.floor(e.amountCents / count), rem = e.amountCents - base * count, off = seedFromId(e.id) % count;
    for (let k = 0; k < count; k++) bump(share, participants[(off + k) % count], base + (k < rem ? 1 : 0));
  }
  for (const s of settlements) { if (s.status !== "confirmed") continue; bump(sent, s.from, s.amountCents); bump(recv, s.to, s.amountCents); }
  const balances = members.map((m) => {
    const p = paid.get(m.id) ?? 0, sh = share.get(m.id) ?? 0, se = sent.get(m.id) ?? 0, re = recv.get(m.id) ?? 0;
    return { memberId: m.id, netCents: p - sh + se - re, paidCents: p, shareCents: sh };
  });
  return { balances, total };
}
const ex = (st) => st.expenses.map((e) => ({ id: e.id, paidBy: e.paidBy, amountCents: e.amountCents, participantIds: e.participantIds }));
const mem = (st) => st.members.map((m) => ({ id: m.id, status: m.status }));

async function main() {
  const ev = await rpc(A, aId, "sp_create_event", {
    p_event_name: "Cabin", p_display_name: "A", p_request_id: randomUUID(),
  });
  const eid = ev.eventId;
  cleanupEventId = eid;
  for (const [cl, dev, nm] of [[B, bId, "B"], [C, cId, "C"]]) {
    await rpc(cl, dev, "sp_join_event", { p_code: ev.code, p_display_name: nm });
  }
  let st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  for (const m of st.members.filter((m) => m.status === "pending"))
    await rpc(A, aId, "sp_member_action", { p_event_id: eid, p_member_id: m.id, p_action: "approve" });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const idOf = (nm) => st.members.find((m) => m.name === nm).id;

  // A pays $100.00 for all three → 33.34 / 33.33 / 33.33 split
  await rpc(A, aId, "sp_add_expense", {
    p_event_id: eid, p_label: "Rent", p_amount_cents: 10000,
    p_paid_by: idOf("A"), p_request_id: randomUUID(),
  });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  let L = computeLedger(mem(st), ex(st), []);
  const shares = L.balances.map((b) => b.shareCents).sort();
  check("3-way $100 shares are 3333/3333/3334", JSON.stringify(shares) === JSON.stringify([3333, 3333, 3334]), shares.join("/"));
  check("shares sum to 10000", L.balances.reduce((s, b) => s + b.shareCents, 0) === 10000);
  check("nets sum to 0", L.balances.reduce((s, b) => s + b.netCents, 0) === 0);

  // --- Reject flow: B claims to have paid A, A rejects ---
  const s1 = await rpc(B, bId, "sp_create_settlement", {
    p_event_id: eid, p_to_member: idOf("A"), p_amount_cents: 3333,
    p_request_id: randomUUID(),
  });
  await rpc(A, aId, "sp_resolve_settlement", { p_event_id: eid, p_settlement_id: s1.id, p_action: "reject" });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const rej = st.settlements.find((s) => s.id === s1.id);
  check("rejected settlement recorded", rej.status === "rejected");
  L = computeLedger(mem(st), ex(st), st.settlements);
  check("rejected settlement does NOT move balances", L.balances.find((b) => b.memberId === idOf("B")).netCents === -3333, `${L.balances.find((b) => b.memberId === idOf("B")).netCents}`);

  // --- Cancel flow: B records again then cancels ---
  const s2 = await rpc(B, bId, "sp_create_settlement", {
    p_event_id: eid, p_to_member: idOf("A"), p_amount_cents: 3333,
    p_request_id: randomUUID(),
  });
  await rpc(B, bId, "sp_resolve_settlement", { p_event_id: eid, p_settlement_id: s2.id, p_action: "cancel" });
  st = await rpc(B, bId, "sp_event_state", { p_event_id: eid });
  check("cancelled settlement is gone", !st.settlements.find((s) => s.id === s2.id));

  // --- Leave → ghost ledger: shares and balances must not be rewritten ---
  await rpc(C, cId, "sp_add_expense", {
    p_event_id: eid, p_label: "Gas", p_amount_cents: 6000,
    p_paid_by: idOf("C"), p_request_id: randomUUID(),
  });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const beforeLeave = computeLedger(mem(st), ex(st), st.settlements);
  const cBefore = beforeLeave.balances.find((b) => b.memberId === idOf("C"));
  await rpc(C, cId, "sp_member_action", { p_event_id: eid, p_member_id: idOf("C"), p_action: "leave" });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const cRow = st.members.find((m) => m.name === "C");
  check("C is now 'left' but still visible (has history)", cRow && cRow.status === "left");
  L = computeLedger(mem(st), ex(st), st.settlements);
  const cBal = L.balances.find((b) => b.memberId === idOf("C"));
  check("ghost C keeps the same immutable share", cBal.shareCents === cBefore.shareCents, `share ${cBal.shareCents}`);
  check("ghost C keeps paid amount", cBal.paidCents === cBefore.paidCents);
  check("leaving does not rewrite C's balance", cBal.netCents === cBefore.netCents, `net ${cBal.netCents}`);
  check("all nets still sum to 0", L.balances.reduce((s, b) => s + b.netCents, 0) === 0, `${L.balances.reduce((s, b) => s + b.netCents, 0)}`);

  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  return failures;
}

async function cleanup() {
  if (!cleanupEventId) return;
  const eventId = cleanupEventId;
  await rpc(A, aId, "sp_delete_event", { p_event_id: eventId });
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
