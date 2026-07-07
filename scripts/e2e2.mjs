// Edge-case flows: reject, 3-way uneven split, leave→ghost ledger.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = "https://chkymwkafaljedtlrqoa.supabase.co";
const KEY = "sb_publishable_oOhF3ge6yDhOEjn-JPrafg_8Ghf3B0q";
const mk = () => createClient(URL, KEY, { auth: { persistSession: false } });
const A = mk(), B = mk(), C = mk();
const aId = randomUUID(), bId = randomUUID(), cId = randomUUID();

let failures = 0;
const check = (l, c, d = "") => { const ok = !!c; console.log(`${ok ? "✅" : "❌"} ${l}${d ? ` — ${d}` : ""}`); if (!ok) failures++; };
async function rpc(cl, dev, fn, args) {
  const { data, error } = await cl.rpc(fn, { p_device_id: dev, ...args });
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
function seedFromId(id) { return parseInt(id.replace(/-/g, "").slice(0, 8), 16) || 0; }
function computeLedger(members, expenses, settlements) {
  const activeIds = members.filter((m) => m.status === "active").map((m) => m.id).sort();
  const n = activeIds.length;
  const paid = new Map(), share = new Map(), sent = new Map(), recv = new Map();
  const bump = (m, k, d) => m.set(k, (m.get(k) ?? 0) + d);
  let total = 0;
  for (const e of expenses) {
    total += e.amountCents; bump(paid, e.paidBy, e.amountCents);
    if (n === 0) continue;
    const base = Math.floor(e.amountCents / n), rem = e.amountCents - base * n, off = seedFromId(e.id) % n;
    for (let k = 0; k < n; k++) bump(share, activeIds[(off + k) % n], base + (k < rem ? 1 : 0));
  }
  for (const s of settlements) { if (s.status !== "confirmed") continue; bump(sent, s.from, s.amountCents); bump(recv, s.to, s.amountCents); }
  const balances = members.map((m) => {
    const p = paid.get(m.id) ?? 0, sh = share.get(m.id) ?? 0, se = sent.get(m.id) ?? 0, re = recv.get(m.id) ?? 0;
    return { memberId: m.id, netCents: p - sh + se - re, paidCents: p, shareCents: sh };
  });
  return { balances, total };
}
const ex = (st) => st.expenses.map((e) => ({ id: e.id, paidBy: e.paidBy, amountCents: e.amountCents }));
const mem = (st) => st.members.map((m) => ({ id: m.id, status: m.status }));

async function main() {
  const ev = await rpc(A, aId, "sp_create_event", { p_event_name: "Cabin", p_display_name: "A" });
  const eid = ev.eventId;
  for (const [cl, dev, nm] of [[B, bId, "B"], [C, cId, "C"]]) {
    await rpc(cl, dev, "sp_join_event", { p_code: ev.code, p_display_name: nm });
  }
  let st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  for (const m of st.members.filter((m) => m.status === "pending"))
    await rpc(A, aId, "sp_member_action", { p_event_id: eid, p_member_id: m.id, p_action: "approve" });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const idOf = (nm) => st.members.find((m) => m.name === nm).id;

  // A pays $100.00 for all three → 33.34 / 33.33 / 33.33 split
  await rpc(A, aId, "sp_add_expense", { p_event_id: eid, p_label: "Rent", p_amount_cents: 10000, p_paid_by: idOf("A") });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  let L = computeLedger(mem(st), ex(st), []);
  const shares = L.balances.map((b) => b.shareCents).sort();
  check("3-way $100 shares are 3333/3333/3334", JSON.stringify(shares) === JSON.stringify([3333, 3333, 3334]), shares.join("/"));
  check("shares sum to 10000", L.balances.reduce((s, b) => s + b.shareCents, 0) === 10000);
  check("nets sum to 0", L.balances.reduce((s, b) => s + b.netCents, 0) === 0);

  // --- Reject flow: B claims to have paid A, A rejects ---
  const s1 = await rpc(B, bId, "sp_create_settlement", { p_event_id: eid, p_to_member: idOf("A"), p_amount_cents: 3333 });
  await rpc(A, aId, "sp_resolve_settlement", { p_event_id: eid, p_settlement_id: s1.id, p_action: "reject" });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const rej = st.settlements.find((s) => s.id === s1.id);
  check("rejected settlement recorded", rej.status === "rejected");
  L = computeLedger(mem(st), ex(st), st.settlements);
  check("rejected settlement does NOT move balances", L.balances.find((b) => b.memberId === idOf("B")).netCents === -3333, `${L.balances.find((b) => b.memberId === idOf("B")).netCents}`);

  // --- Cancel flow: B records again then cancels ---
  const s2 = await rpc(B, bId, "sp_create_settlement", { p_event_id: eid, p_to_member: idOf("A"), p_amount_cents: 3333 });
  await rpc(B, bId, "sp_resolve_settlement", { p_event_id: eid, p_settlement_id: s2.id, p_action: "cancel" });
  st = await rpc(B, bId, "sp_event_state", { p_event_id: eid });
  check("cancelled settlement is gone", !st.settlements.find((s) => s.id === s2.id));

  // --- Leave → ghost ledger: C pays an expense, then leaves ---
  await rpc(C, cId, "sp_add_expense", { p_event_id: eid, p_label: "Gas", p_amount_cents: 6000, p_paid_by: idOf("C") });
  await rpc(C, cId, "sp_member_action", { p_event_id: eid, p_member_id: idOf("C"), p_action: "leave" });
  st = await rpc(A, aId, "sp_event_state", { p_event_id: eid });
  const cRow = st.members.find((m) => m.name === "C");
  check("C is now 'left' but still visible (has history)", cRow && cRow.status === "left");
  L = computeLedger(mem(st), ex(st), st.settlements);
  const cBal = L.balances.find((b) => b.memberId === idOf("C"));
  check("ghost C takes no share of costs", cBal.shareCents === 0, `share ${cBal.shareCents}`);
  check("ghost C keeps paid amount", cBal.paidCents === 6000);
  check("ghost C is owed back what they paid", cBal.netCents === 6000);
  // Now only A and B are active; total split among active for share, but C's paid still counts
  check("all nets still sum to 0", L.balances.reduce((s, b) => s + b.netCents, 0) === 0, `${L.balances.reduce((s, b) => s + b.netCents, 0)}`);

  await rpc(A, aId, "sp_delete_my_data", {});
  await rpc(B, bId, "sp_delete_my_data", {});
  await rpc(C, cId, "sp_delete_my_data", {});
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("💥", e.message); process.exit(1); });
