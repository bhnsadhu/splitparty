"use client";

import { useMemo, useState } from "react";
import { Button, Chip, Field, Money, Sheet, TextInput, timeAgo } from "@/components/ui";
import { api } from "@/lib/client";
import { formatMoney, parseMoney } from "@/lib/money";
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

  const pending = state.settlements.filter((s) => s.status === "pending");
  const confirmQueue = pending.filter((s) => s.to === me);
  const waiting = pending.filter((s) => s.from === me);
  const history = state.settlements.filter((s) => s.status !== "pending");

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

  async function resolve(sid: string, action: "confirm" | "reject" | "cancel") {
    setBusyId(sid);
    try {
      await api(`/api/events/${state.event.id}/settlements/${sid}`, { action });
      await refetch();
      if (action === "confirm") notify("Confirmed. Ledger updated for everyone.");
      if (action === "reject") notify("Sent back. It stays owed until it's real.");
      if (action === "cancel") notify("Cancelled.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setBusyId(null);
    }
  }

  const allSquare =
    state.transfers.length === 0 && pending.length === 0 && state.totalSpentCents > 0;

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
                      onClick={() => resolve(s.id, "confirm")}
                    >
                      Yep, got it
                    </Button>
                    <Button
                      small
                      variant="ghost"
                      disabled={busyId === s.id}
                      onClick={() => resolve(s.id, "reject")}
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
              {state.transfers.length === 1 ? "payment" : "payments"}, the fewest
              possible
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
                  className="shrink-0 text-xs font-bold text-faint underline"
                  disabled={busyId === s.id}
                  onClick={() => resolve(s.id, "cancel")}
                >
                  cancel
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <Button variant="quiet" full onClick={() => setPaySheet({ to: "", suggestCents: 0 })}>
        Record a payment I made
      </Button>

      {/* ---- History ---- */}
      {history.length > 0 && (
        <section>
          <SectionTitle>Settled</SectionTitle>
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
  onPay,
}: {
  t: Transfer;
  me: string;
  name: (id: string) => string;
  pendingCents: number;
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
          {iOwe && pendingCents === 0 && (
            <Button small onClick={onPay}>
              I paid this back
            </Button>
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
        <span className="font-bold">{name(s.from)}</span> paid{" "}
        <span className="font-bold">{name(s.to)}</span>{" "}
        <Money cents={s.amountCents} className="font-bold" />
        {rejected ? ", declined" : ""}
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

  // People you can pay back: anyone in the room, or anyone who left but is
  // still on the ledger. Never yourself.
  const balanceIds = new Set(state.balances.map((b) => b.memberId));
  const options = state.members.filter(
    (m) =>
      m.id !== me &&
      m.status !== "pending" &&
      m.status !== "denied" &&
      (m.status === "active" || balanceIds.has(m.id)),
  );

  const cents = parseMoney(amount);
  const owed = state.transfers
    .filter((t) => t.from === me && t.to === to)
    .reduce((sum, t) => sum + t.amountCents, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cents || !to) return;
    setBusy(true);
    try {
      await api(`/api/events/${state.event.id}/settlements`, {
        toMemberId: to,
        amountCents: cents,
      });
      await refetch();
      onClose();
      notify("Sent. It counts once they confirm.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't record that.");
      setBusy(false);
    }
  }

  const toName = state.members.find((m) => m.id === to)?.name;

  return (
    <Sheet open onClose={onClose} title="I paid someone back">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Who">
          <div className="flex flex-wrap gap-2">
            {options.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setTo(m.id)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  to === m.id ? "bg-blue text-ink" : "border border-line text-dim"
                }`}
              >
                {m.name}
                {m.status !== "active" ? " (left)" : ""}
              </button>
            ))}
          </div>
        </Field>
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
            />
          </div>
        </Field>
        {amount && !cents && (
          <p className="text-sm font-bold text-red">Amounts look like 12 or 12.50.</p>
        )}
        {cents && to && owed > 0 && cents > owed && (
          <p className="text-sm text-dim">
            That&rsquo;s more than the {formatMoney(owed)} the plan says you owe{" "}
            {toName}. Still fine, it all nets out once they confirm.
          </p>
        )}
        <p className="text-xs text-dim">
          Nothing settles until {toName ?? "they"} confirms they got it.
        </p>
        <Button full disabled={busy || !cents || !to}>
          {busy ? "Recording…" : "Record it"}
        </Button>
      </form>
    </Sheet>
  );
}
