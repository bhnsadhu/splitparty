import assert from "node:assert/strict";
import test from "node:test";
import { computeLedger } from "../lib/settle.ts";

type Member = { id: string; status: string };
type Expense = {
  id: string;
  paidBy: string;
  amountCents: number;
  participantIds?: string[];
};
type Settlement = {
  from: string;
  to: string;
  amountCents: number;
  status: string;
};

const member = (id: string, status = "active"): Member => ({ id, status });
const expense = (
  id: string,
  paidBy: string,
  amountCents: number,
  participantIds?: string[],
): Expense => ({ id, paidBy, amountCents, participantIds });
const settlement = (
  from: string,
  to: string,
  amountCents: number,
  status: string,
): Settlement => ({ from, to, amountCents, status });

function balancesById(ledger: ReturnType<typeof computeLedger>) {
  return Object.fromEntries(ledger.balances.map((balance) => [balance.memberId, balance]));
}

function assertTransferPlanSettles(ledger: ReturnType<typeof computeLedger>) {
  const residual = new Map(ledger.balances.map((balance) => [balance.memberId, balance.netCents]));
  for (const transfer of ledger.transfers) {
    residual.set(transfer.from, (residual.get(transfer.from) ?? 0) + transfer.amountCents);
    residual.set(transfer.to, (residual.get(transfer.to) ?? 0) - transfer.amountCents);
  }
  assert.ok([...residual.values()].every((amount) => amount === 0));
  const nonzero = ledger.balances.filter((balance) => balance.netCents !== 0).length;
  assert.ok(ledger.transfers.length <= Math.max(0, nonzero - 1));
}

test("equal split produces exact balances and repayment", () => {
  const ledger = computeLedger(
    [member("a"), member("b")],
    [expense("00000000-equal", "a", 1_000, ["a", "b"])],
    [],
  );
  const balances = balancesById(ledger);

  assert.equal(ledger.totalSpentCents, 1_000);
  assert.equal(balances.a.shareCents, 500);
  assert.equal(balances.b.shareCents, 500);
  assert.equal(balances.a.netCents, 500);
  assert.equal(balances.b.netCents, -500);
  assert.deepEqual(ledger.transfers, [{ from: "b", to: "a", amountCents: 500 }]);
});

test("odd cents rotate deterministically and shares remain exact", () => {
  const ledger = computeLedger(
    [member("a"), member("b"), member("c")],
    [expense("00000000-odd", "a", 10_000, ["c", "b", "a"])],
    [],
  );
  const shares = ledger.balances.map((balance) => balance.shareCents).sort((a, b) => a - b);

  assert.deepEqual(shares, [3_333, 3_333, 3_334]);
  assert.equal(shares.reduce((sum, amount) => sum + amount, 0), 10_000);
  assertTransferPlanSettles(ledger);
});

test("multiple payers and decimal cents net correctly", () => {
  const ledger = computeLedger(
    [member("a"), member("b")],
    [
      expense("00000000-pizza", "a", 4_000, ["a", "b"]),
      expense("00000000-drinks", "b", 1_501, ["a", "b"]),
    ],
    [],
  );
  const balances = balancesById(ledger);

  assert.equal(ledger.totalSpentCents, 5_501);
  assert.equal(balances.a.netCents, 1_249);
  assert.equal(balances.b.netCents, -1_249);
  assert.deepEqual(ledger.transfers, [{ from: "b", to: "a", amountCents: 1_249 }]);
});

test("immutable participants survive departure and exclude later joiners", () => {
  const expenseBeforeMembershipChange = expense("00000000-history", "a", 10_000, ["a", "b"]);
  const afterDepartureAndJoin = computeLedger(
    [member("a"), member("b", "left"), member("c")],
    [expenseBeforeMembershipChange],
    [],
  );
  const balances = balancesById(afterDepartureAndJoin);

  assert.equal(balances.a.shareCents, 5_000);
  assert.equal(balances.b.shareCents, 5_000);
  assert.equal(balances.b.netCents, -5_000);
  assert.equal(balances.c.shareCents, 0);
  assert.deepEqual(afterDepartureAndJoin.transfers, [
    { from: "b", to: "a", amountCents: 5_000 },
  ]);

  const confirmedBeforeDeparture = computeLedger(
    [member("a"), member("b", "left"), member("c")],
    [expenseBeforeMembershipChange],
    [settlement("b", "a", 5_000, "confirmed")],
  );
  assert.equal(balancesById(confirmedBeforeDeparture).a.netCents, 0);
  assert.equal(balancesById(confirmedBeforeDeparture).b.netCents, 0);
  assert.deepEqual(confirmedBeforeDeparture.transfers, []);
});

test("missing or empty legacy participant snapshot falls back to active roster", () => {
  const legacy = computeLedger(
    [member("a"), member("b", "left"), member("c")],
    [expense("00000000-legacy", "a", 10_000)],
    [],
  );
  const explicitEmpty = computeLedger(
    [member("a"), member("b")],
    [expense("00000000-empty", "a", 10_000, [])],
    [],
  );

  assert.equal(balancesById(legacy).a.shareCents, 5_000);
  assert.equal(balancesById(legacy).c.shareCents, 5_000);
  assert.equal(balancesById(legacy).b, undefined);
  assert.equal(explicitEmpty.balances.reduce((sum, balance) => sum + balance.shareCents, 0), 10_000);
});

test("pending and rejected payments do not move money; confirmed payments do", () => {
  const members = [member("a"), member("b")];
  const expenses = [expense("00000000-payment", "a", 10_000, ["a", "b"])];

  for (const status of ["pending", "rejected"]) {
    const ledger = computeLedger(members, expenses, [settlement("b", "a", 5_000, status)]);
    assert.equal(balancesById(ledger).a.netCents, 5_000);
    assert.equal(balancesById(ledger).b.netCents, -5_000);
  }

  const confirmed = computeLedger(members, expenses, [
    settlement("b", "a", 5_000, "confirmed"),
  ]);
  assert.equal(balancesById(confirmed).a.netCents, 0);
  assert.equal(balancesById(confirmed).b.netCents, 0);
  assert.deepEqual(confirmed.transfers, []);
});

test("deterministic fuzz preserves share, net, and transfer invariants", () => {
  let seed = 0x5f3759df;
  const random = () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32);

  for (let scenario = 0; scenario < 5_000; scenario++) {
    const count = 1 + Math.floor(random() * 10);
    const members = Array.from({ length: count }, (_, index) =>
      member(String.fromCharCode(97 + index), random() < 0.75 ? "active" : "left"),
    );
    const expenses = Array.from({ length: Math.floor(random() * 16) }, (_, index) => {
      const participants = members
        .filter(() => random() < 0.7)
        .map((item) => item.id);
      if (participants.length === 0) participants.push(members[Math.floor(random() * count)].id);
      return expense(
        Math.floor(random() * 2 ** 32).toString(16).padStart(8, "0") + `-${index}`,
        members[Math.floor(random() * count)].id,
        1 + Math.floor(random() * 100_000_000),
        participants,
      );
    });
    const settlements = Array.from({ length: Math.floor(random() * 12) }, () => {
      const from = Math.floor(random() * count);
      let to = Math.floor(random() * count);
      if (from === to) to = (to + 1) % count;
      return settlement(
        members[from].id,
        members[to].id,
        1 + Math.floor(random() * 100_000_000),
        random() < 0.6 ? "confirmed" : random() < 0.5 ? "pending" : "rejected",
      );
    });

    const ledger = computeLedger(members, expenses, settlements);
    const reversed = computeLedger(
      [...members].reverse(),
      [...expenses].reverse(),
      [...settlements].reverse(),
    );
    const totalShares = ledger.balances.reduce((sum, balance) => sum + balance.shareCents, 0);
    const totalNet = ledger.balances.reduce((sum, balance) => sum + balance.netCents, 0);

    assert.equal(totalShares, ledger.totalSpentCents, `share mismatch in scenario ${scenario}`);
    assert.equal(totalNet, 0, `net mismatch in scenario ${scenario}`);
    assert.deepEqual(ledger.transfers, reversed.transfers, `nondeterminism in scenario ${scenario}`);
    assertTransferPlanSettles(ledger);
  }
});
