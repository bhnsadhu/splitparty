import type { Balance, Transfer } from "./types";

interface MemberIn {
  id: string;
  status: string;
}
interface ExpenseIn {
  id: string;
  paid_by: string;
  amount_cents: number;
}
interface SettlementIn {
  from_member: string;
  to_member: string;
  amount_cents: number;
  status: string;
}

/** Deterministic small seed from a uuid so leftover pennies rotate fairly across expenses. */
function seedFromId(id: string): number {
  const hex = id.replace(/-/g, "").slice(0, 8);
  return parseInt(hex, 16) || 0;
}

export interface Ledger {
  balances: Balance[];
  transfers: Transfer[];
  totalSpentCents: number;
}

/**
 * The whole ledger in one pass, all integer cents.
 *
 * Rules:
 * - Every expense splits evenly across members who are currently ACTIVE.
 *   Leftover pennies go to a rotating subset (seeded by expense id) so no
 *   one systematically eats the remainder. Shares always sum exactly to the
 *   expense amount, so all nets sum to exactly zero.
 * - Members who left/were removed keep their paid expenses and confirmed
 *   settlements (history is never rewritten) but take no share of costs.
 * - Only CONFIRMED settlements move balances. Pending ones are display-only
 *   until the receiver approves.
 * - net > 0: the group owes them. net < 0: they owe the group.
 */
export function computeLedger(
  members: MemberIn[],
  expenses: ExpenseIn[],
  settlements: SettlementIn[],
): Ledger {
  const activeIds = members
    .filter((m) => m.status === "active")
    .map((m) => m.id)
    .sort();
  const n = activeIds.length;

  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  const sent = new Map<string, number>();
  const recv = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, delta: number) =>
    map.set(key, (map.get(key) ?? 0) + delta);

  let totalSpentCents = 0;
  for (const e of expenses) {
    totalSpentCents += e.amount_cents;
    bump(paid, e.paid_by, e.amount_cents);
    if (n === 0) continue;
    const base = Math.floor(e.amount_cents / n);
    const remainder = e.amount_cents - base * n;
    const offset = seedFromId(e.id) % n;
    for (let k = 0; k < n; k++) {
      const memberId = activeIds[(offset + k) % n];
      bump(share, memberId, base + (k < remainder ? 1 : 0));
    }
  }

  for (const s of settlements) {
    if (s.status !== "confirmed") continue;
    bump(sent, s.from_member, s.amount_cents);
    bump(recv, s.to_member, s.amount_cents);
  }

  const balances: Balance[] = members
    .map((m) => {
      const p = paid.get(m.id) ?? 0;
      const sh = share.get(m.id) ?? 0;
      const se = sent.get(m.id) ?? 0;
      const re = recv.get(m.id) ?? 0;
      return {
        memberId: m.id,
        paidCents: p,
        shareCents: sh,
        sentCents: se,
        recvCents: re,
        netCents: p - sh + se - re,
      };
    })
    .filter((b) => {
      const m = members.find((mm) => mm.id === b.memberId)!;
      if (m.status === "active") return true;
      // Ghosts stay on the ledger only while they still matter financially.
      return b.paidCents !== 0 || b.sentCents !== 0 || b.recvCents !== 0;
    });

  return { balances, transfers: minTransfers(balances), totalSpentCents };
}

/**
 * Greedy debt simplification: repeatedly match the largest debtor with the
 * largest creditor. Produces at most (participants - 1) payments and always
 * zeroes every balance exactly, in cents.
 */
export function minTransfers(balances: Balance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ id: b.memberId, amt: b.netCents }));
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ id: b.memberId, amt: -b.netCents }));
  // Stable order: biggest first, uuid as tiebreak, so everyone's app shows the same plan.
  const byAmt = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || a.id.localeCompare(b.id);
  creditors.sort(byAmt);
  debtors.sort(byAmt);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const t = Math.min(debtors[i].amt, creditors[j].amt);
    if (t > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amountCents: t });
    debtors[i].amt -= t;
    creditors[j].amt -= t;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}
