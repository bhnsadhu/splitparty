"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Field, FieldGroup, Money, Sheet, TextInput, timeAgo } from "@/components/ui";
import {
  clearPendingMutation,
  createSettlement,
  loadPendingMutation,
  mutationMayHaveCommitted,
  newRequestId,
  resolveSettlement,
  savePendingMutation,
} from "@/lib/client";
import { formatMoney, parseMoney } from "@/lib/money";
import {
  isPaymentPayload,
  paymentRecoveryMatchesSettlement,
  type PaymentPayload,
} from "@/lib/recovery";
import type { EventState, SettlementPub, Transfer } from "@/lib/types";

export default function SettleTab({
  state,
  refetch,
  notify,
}: {
  state: EventState;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const me = state.me.memberId;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [paySheet, setPaySheet] = useState<{ to: string; suggestCents: number } | null>(
    null,
  );

  const nameById = useMemo(
    () => new Map(state.members.map((m) => [m.id, m.name])),
    [state.members],
  );
  const name = (id: string) => (id === me ? "you" : (nameById.get(id) ?? "someone"));
  const Name = ({ id }: { id: string }) => (
    <span className="font-bold text-ink">{name(id)}</span>
  );

  const myBalance = state.balances.find((b) => b.memberId === me);
  const net = myBalance?.netCents ?? 0;

  const pending = useMemo(
    () => state.settlements.filter((s) => s.status === "pending"),
    [state.settlements],
  );
  const confirmQueue = pending.filter((s) => s.to === me);
  const waiting = pending.filter((s) => s.from === me);
  const history = state.settlements.filter((s) => s.status !== "pending");
  const paymentOptions = eligiblePaymentMembers(state, me);
  const noMoneyActivity = state.expenses.length === 0 && state.settlements.length === 0;

  // Pending claims laid over the plan so nobody double-pays.
  const pendingByPair = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of pending) {
      const k = `${s.from}|${s.to}`;
      map.set(k, (map.get(k) ?? 0) + s.amountCents);
    }
    return map;
  }, [pending]);

  const owedToMeBy = (fromId: string) =>
    state.transfers
      .filter((t) => t.from === fromId && t.to === me)
      .reduce((sum, t) => sum + t.amountCents, 0);

  async function resolve(
    settlement: SettlementPub,
    action: "confirm" | "reject" | "cancel",
  ) {
    setBusyId(settlement.id);
    try {
      if (action === "cancel") {
        const pendingScope = `create-payment:${state.event.id}`;
        const recovered = loadPendingMutation(pendingScope, isPaymentPayload);
        if (
          recovered &&
          paymentRecoveryMatchesSettlement(recovered.payload, settlement)
        ) {
          // Remove the retry before deleting its server-side idempotency row.
          // If storage is unavailable, aborting the cancel prevents resurrection.
          clearPendingMutation(pendingScope);
        }
      }
      await resolveSettlement(state.event.id, settlement.id, action);
      await refetch();
      if (action === "confirm") notify("Confirmed. Ledger updated for everyone.");
      if (action === "reject") notify("Declined. The ledger didn't change.");
      if (action === "cancel") notify("Cancelled.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setBusyId(null);
    }
  }

  const allSquare =
    state.balances.every((balance) => balance.netCents === 0) &&
    pending.length === 0 &&
    state.totalSpentCents > 0;

  if (noMoneyActivity) {
    return (
      <div className="fade-in rounded-2xl border border-dashed border-line px-5 py-8 text-center">
        <h2 className="font-display text-xl font-bold text-ink">Nothing to settle yet.</h2>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Add the first expense in Spend. The square-up plan will appear here as the
          party logs purchases.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in space-y-8">
      {/* ---- My status ---- */}
      <section
        className={`rounded-3xl border p-5 ${
          net !== 0 ? "border-red/40 bg-red/10" : "border-green/40 bg-green/10"
        }`}
      >
        <p className="text-xs font-bold uppercase tracking-widest text-faint">
          Where you stand
        </p>
        <p
          className={`mt-1 font-display text-3xl font-black tracking-tight ${
            net !== 0 ? "text-red" : "text-green"
          }`}
        >
          {net > 0 ? (
            <>You get back <Money cents={net} /></>
          ) : net < 0 ? (
            <>You owe <Money cents={-net} /></>
          ) : (
            "You're square ✓"
          )}
        </p>
        {myBalance && (
          <p className="mt-2 text-sm text-dim">
            you paid <Money cents={myBalance.paidCents} className="font-bold" /> · your
            share is <Money cents={myBalance.shareCents} className="font-bold" />
            {myBalance.sentCents > 0 && (
              <> · paid back <Money cents={myBalance.sentCents} className="font-bold" /></>
            )}
            {myBalance.recvCents > 0 && (
              <> · received <Money cents={myBalance.recvCents} className="font-bold" /></>
            )}
          </p>
        )}
      </section>

      {/* ---- Waiting on my confirmation ---- */}
      {confirmQueue.length > 0 && (
        <section>
          <SectionTitle>Confirm these</SectionTitle>
          <div className="space-y-3">
            {confirmQueue.map((s) => {
              const owed = owedToMeBy(s.from);
              return (
                <div
                  key={s.id}
                  className="rounded-2xl border border-red/40 bg-surface p-4"
                >
                  <p className="text-sm text-ink">
                    <Name id={s.from} /> says they paid you{" "}
                    <Money cents={s.amountCents} className="font-bold text-red" />
                    <span className="text-faint"> · {timeAgo(s.createdAt)}</span>
                  </p>
                  {owed !== s.amountCents && (
                    <p className="mt-1 text-xs text-dim">
                      {owed > 0
                        ? `Heads up: the plan says they owe you ${formatMoney(owed)}.`
                        : "Heads up: the plan doesn't show them owing you right now."}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      small
                      disabled={busyId === s.id}
                      onClick={() => resolve(s, "confirm")}
                    >
                      Yep, got it
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      disabled={busyId === s.id}
                      onClick={() => resolve(s, "reject")}
                    >
                      No they didn&rsquo;t
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- All square moment ---- */}
      {allSquare && (
        <section className="-rotate-1 rounded-3xl bg-green p-6 text-void">
          <p className="font-display text-3xl font-black leading-tight">
            EVERYONE&rsquo;S SQUARE.
          </p>
          <p className="mt-2 text-sm font-bold">
            {formatMoney(state.totalSpentCents)} of damage, fully settled.
            Screenshot this for the group chat.
          </p>
        </section>
      )}

      {/* ---- The plan ---- */}
      {state.transfers.length > 0 && (
        <section>
          <SectionTitle>
            The square-up plan{" "}
            <span className="font-normal normal-case text-faint">
              · {state.transfers.length}{" "}
              {state.transfers.length === 1 ? "payment" : "payments"}
            </span>
          </SectionTitle>
          <div className="space-y-2">
            {state.transfers.map((t, i) => (
              <PlanRow
                key={`${t.from}-${t.to}-${i}`}
                t={t}
                me={me}
                name={name}
                pendingCents={pendingByPair.get(`${t.from}|${t.to}`) ?? 0}
                canReceive={state.members.some(
                  (member) => member.id === t.to && member.canReceivePayment !== false,
                )}
                onPay={() => setPaySheet({ to: t.to, suggestCents: t.amountCents })}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---- Waiting on others ---- */}
      {waiting.length > 0 && (
        <section>
          <SectionTitle>Waiting on their confirmation</SectionTitle>
          <div className="space-y-2">
            {waiting.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1 text-sm text-dim">
                  You paid <Name id={s.to} />{" "}
                  <Money cents={s.amountCents} className="font-bold text-red" />
                  <Chip tone="red" className="ml-2">pending</Chip>
                </div>
                <button
                  className="inline-flex min-h-11 shrink-0 items-center px-2 text-xs font-bold text-faint underline"
                  disabled={busyId === s.id}
                  onClick={() => resolve(s, "cancel")}
                >
                  cancel
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {paymentOptions.length > 0 ? (
        <Button variant="quiet" full onClick={() => setPaySheet({ to: "", suggestCents: 0 })}>
          Record a payment I made
        </Button>
      ) : (
        <div className="rounded-2xl border border-dashed border-line px-5 py-5 text-center">
          <p className="text-sm text-dim">
            You&rsquo;re the only person available to pay. Share the party code and
            approve someone in Crew before recording a payment.
          </p>
        </div>
      )}

      {/* ---- History ---- */}
      {history.length > 0 && (
        <section>
          <SectionTitle>Payment history</SectionTitle>
          <ul className="space-y-1">
            {history.map((s) => (
              <HistoryRow key={s.id} s={s} name={name} />
            ))}
          </ul>
        </section>
      )}

      {paySheet && (
        <RecordPaymentSheet
          state={state}
          initialTo={paySheet.to}
          suggestCents={paySheet.suggestCents}
          onClose={() => setPaySheet(null)}
          refetch={refetch}
          notify={notify}
        />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-faint">
      {children}
    </h3>
  );
}

function PlanRow({
  t,
  me,
  name,
  pendingCents,
  canReceive,
  onPay,
}: {
  t: Transfer;
  me: string;
  name: (id: string) => string;
  pendingCents: number;
  canReceive: boolean;
  onPay: () => void;
}) {
  const iOwe = t.from === me;
  const owedMe = t.to === me;
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        iOwe ? "border-red/40 bg-surface" : owedMe ? "border-red/30 bg-surface" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-dim">
          <span className="font-bold text-ink">{name(t.from)}</span>{" "}
          {iOwe ? "owe" : "owes"}{" "}
          <span className="font-bold text-ink">{name(t.to)}</span>
        </p>
        <Money cents={t.amountCents} className="shrink-0 text-base font-bold text-red" />
      </div>
      {(pendingCents > 0 || iOwe) && (
        <div className="mt-2 flex items-center gap-2">
          {pendingCents > 0 && (
            <Chip tone="red">{formatMoney(pendingCents)} pending confirmation</Chip>
          )}
          {iOwe && pendingCents === 0 && canReceive && (
            <Button small onClick={onPay}>
              I paid this back
            </Button>
          )}
          {iOwe && pendingCents === 0 && !canReceive && (
            <Chip tone="dim">Departed · can&rsquo;t confirm payments</Chip>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  s,
  name,
}: {
  s: SettlementPub;
  name: (id: string) => string;
}) {
  const rejected = s.status === "rejected";
  return (
    <li className="flex items-center gap-3 px-2 py-2 text-sm">
      <span className={`min-w-0 flex-1 ${rejected ? "text-faint" : "text-dim"}`}>
        {rejected ? (
          <>
            <span className="font-bold">{name(s.from)}</span>&rsquo;s reported payment to{" "}
            <span className="font-bold">{name(s.to)}</span> of{" "}
            <Money cents={s.amountCents} className="font-bold" /> was declined
          </>
        ) : (
          <>
            <span className="font-bold">{name(s.from)}</span> paid{" "}
            <span className="font-bold">{name(s.to)}</span>{" "}
            <Money cents={s.amountCents} className="font-bold" />
          </>
        )}
        <span className="text-faint">
          {" "}· {timeAgo(s.resolvedAt ?? s.createdAt)}
        </span>
      </span>
      <span
        className={`shrink-0 font-bold ${rejected ? "text-red" : "text-green"}`}
        aria-label={rejected ? "declined" : "settled"}
      >
        {rejected ? "✕" : "✓"}
      </span>
    </li>
  );
}

function RecordPaymentSheet({
  state,
  initialTo,
  suggestCents,
  onClose,
  refetch,
  notify,
}: {
  state: EventState;
  initialTo: string;
  suggestCents: number;
  onClose: () => void;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const me = state.me.memberId;
  const [to, setTo] = useState(initialTo);
  const [amount, setAmount] = useState(
    suggestCents > 0 ? (suggestCents / 100).toFixed(2) : "",
  );
  const [busy, setBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const requestId = useRef<string | null>(null);
  const requestPayload = useRef<PaymentPayload | null>(null);
  const pendingScope = `create-payment:${state.event.id}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const pending = loadPendingMutation(pendingScope, isPaymentPayload);
        if (!pending) return;
        requestId.current = pending.requestId;
        requestPayload.current = pending.payload;
        setTo(pending.payload.to);
        setAmount(pending.payload.amount);
        setRetryLocked(true);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Couldn't restore a saved payment retry.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [notify, pendingScope]);

  // People you can pay back: anyone in the room, or anyone who left but is
  // still on the ledger. Never yourself.
  const options = eligiblePaymentMembers(state, me);

  const cents = parseMoney(amount);
  const owed = state.transfers
    .filter((t) => t.from === me && t.to === to)
    .reduce((sum, t) => sum + t.amountCents, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cents || !to) return;
    setBusy(true);
    try {
      if (!requestId.current || !requestPayload.current) {
        requestId.current = newRequestId();
        requestPayload.current = { to, amount, amountCents: cents };
        savePendingMutation(pendingScope, {
          requestId: requestId.current,
          payload: requestPayload.current,
        });
      }
      const payload = requestPayload.current;
      await createSettlement(
        state.event.id,
        payload.to,
        payload.amountCents,
        requestId.current,
      );
      await refetch();
      try {
        clearPendingMutation(pendingScope);
      } catch {
        // Retaining the same recovery UUID cannot duplicate the saved payment.
      }
      onClose();
      notify("Sent. It counts once they confirm.");
    } catch (err) {
      if (mutationMayHaveCommitted(err)) {
        const payload = requestPayload.current;
        if (payload) {
          setTo(payload.to);
          setAmount(payload.amount);
        }
        setRetryLocked(true);
      } else {
        try {
          clearPendingMutation(pendingScope);
          requestId.current = null;
          requestPayload.current = null;
          setRetryLocked(false);
        } catch {
          setRetryLocked(true);
        }
      }
      notify(err instanceof Error ? err.message : "Couldn't record that.");
      setBusy(false);
    }
  }

  const toName = state.members.find((m) => m.id === to)?.name;

  return (
    <Sheet open onClose={onClose} title="I paid someone back" preventClose={busy}>
      <form onSubmit={submit} className="space-y-4">
        <FieldGroup label="Who">
          <div className="flex flex-wrap gap-2">
            {options.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={to === m.id}
                disabled={busy || retryLocked}
                onClick={() => setTo(m.id)}
                className={`min-h-11 rounded-full px-4 text-sm font-bold transition-colors disabled:opacity-50 ${
                  to === m.id ? "bg-ink text-void" : "border border-line text-dim"
                }`}
              >
                {m.name}
                {m.status !== "active" ? " (outside party)" : ""}
              </button>
            ))}
          </div>
        </FieldGroup>
        <Field label="How much (cash, Venmo, whatever, this just records it)">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-faint">
              $
            </span>
            <TextInput
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="pl-9 text-lg font-bold tnum"
              required
              disabled={busy || retryLocked}
            />
          </div>
        </Field>
        {amount && !cents && (
          <p className="text-sm font-bold text-red">Amounts look like 12 or 12.50.</p>
        )}
        {cents && to && owed > 0 && cents > owed && (
          <p className="text-sm text-dim">
            That&rsquo;s more than the {formatMoney(owed)} the plan says you owe{" "}
            {toName}. If they confirm it, the ledger will show the difference owed
            back.
          </p>
        )}
        {retryLocked && (
          <p className="text-sm text-dim">
            This payment may already be waiting for confirmation. Keep these
            details unchanged and retry once to recover it safely.
          </p>
        )}
        <p className="text-xs text-dim">
          Nothing settles until {toName ?? "they"} confirms they got it.
        </p>
        <Button full disabled={busy || !cents || !to}>
          {busy ? "Recording…" : retryLocked ? "Check & retry" : "Record it"}
        </Button>
      </form>
    </Sheet>
  );
}

function eligiblePaymentMembers(state: EventState, me: string) {
  const balanceIds = new Set(state.balances.map((balance) => balance.memberId));
  return state.members.filter(
    (member) =>
      member.id !== me &&
      member.canReceivePayment !== false &&
      (member.status === "active" || balanceIds.has(member.id)),
  );
}
