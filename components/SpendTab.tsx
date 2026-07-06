"use client";

import { useMemo, useState } from "react";
import { Avatar, Button, Field, Money, Sheet, TextInput, timeAgo } from "@/components/ui";
import { api } from "@/lib/client";
import { parseMoney } from "@/lib/money";
import type { EventState } from "@/lib/types";

export default function SpendTab({
  state,
  refetch,
  notify,
  goSettle,
}: {
  state: EventState;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
  goSettle: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const nameById = useMemo(
    () => new Map(state.members.map((m) => [m.id, m.name])),
    [state.members],
  );
  const activeMembers = state.members.filter((m) => m.status === "active");

  return (
    <div className="fade-in">
      {state.pendingForMe > 0 && (
        <button
          onClick={goSettle}
          className="mb-4 w-full rounded-2xl border border-red/40 bg-red/10 px-4 py-3 text-left text-sm font-bold text-red"
        >
          {state.pendingForMe === 1
            ? "Someone says they paid you back, confirm it →"
            : `${state.pendingForMe} payments waiting on your confirmation →`}
        </button>
      )}

      <section className="mb-6 rounded-3xl border border-line bg-surface p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-faint">
          The damage
        </p>
        <p className="mt-1 font-display text-5xl font-black tracking-tight text-ink">
          <Money cents={state.totalSpentCents} />
        </p>
        <p className="mt-2 text-sm text-dim">
          split evenly between {activeMembers.length}{" "}
          {activeMembers.length === 1 ? "person" : "people"}
        </p>
      </section>

      <Button full onClick={() => setAdding(true)} className="mb-6">
        + I bought something
      </Button>

      {state.expenses.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-dim">
          Nothing logged yet. Someone definitely bought something. Get it in
          here before they forget the number.
        </p>
      ) : (
        <ul className="space-y-1">
          {state.expenses.map((e) => {
            const payer = nameById.get(e.paidBy) ?? "Someone";
            const isMe = e.paidBy === state.me.memberId;
            return (
              <li key={e.id} className="flex items-center gap-3 rounded-2xl px-2 py-3">
                <Avatar name={payer} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{e.label}</p>
                  <p className="text-sm text-faint">
                    {isMe ? "you" : payer} paid · {timeAgo(e.createdAt)}
                  </p>
                </div>
                <Money cents={e.amountCents} className="shrink-0 font-bold text-ink" />
              </li>
            );
          })}
        </ul>
      )}

      <AddExpenseSheet
        open={adding}
        onClose={() => setAdding(false)}
        state={state}
        refetch={refetch}
        notify={notify}
      />
    </div>
  );
}

function AddExpenseSheet({
  open,
  onClose,
  state,
  refetch,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  state: EventState;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const me = state.me.memberId;
  const payerId = paidBy ?? me;
  // Me first, then the rest of the room.
  const payers = [...state.members.filter((m) => m.status === "active")].sort(
    (a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)),
  );
  const cents = parseMoney(amount);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cents) return;
    setBusy(true);
    try {
      await api(`/api/events/${state.event.id}/expenses`, {
        label,
        amountCents: cents,
        paidBy: payerId,
      });
      await refetch();
      setLabel("");
      setAmount("");
      setPaidBy(null);
      onClose();
      notify("Logged. Everyone can see it.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't log it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="What got bought?">
      <form onSubmit={submit} className="space-y-4">
        <Field label="The thing">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Cake, balloons, 3 pizzas…"
            maxLength={80}
            required
          />
        </Field>
        <Field label="How much">
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
        <Field label="Who paid">
          <div className="flex flex-wrap gap-2">
            {payers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPaidBy(m.id)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  payerId === m.id
                    ? "bg-blue text-ink"
                    : "border border-line text-dim"
                }`}
              >
                {m.id === me ? "me" : m.name}
              </button>
            ))}
          </div>
        </Field>
        {amount && !cents && (
          <p className="text-sm font-bold text-red">
            Amounts look like 12 or 12.50.
          </p>
        )}
        <Button full disabled={busy || !cents || !label.trim()}>
          {busy ? "Logging…" : cents ? `Log it, $${(cents / 100).toFixed(2)}` : "Log it"}
        </Button>
      </form>
    </Sheet>
  );
}
