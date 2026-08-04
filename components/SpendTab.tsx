"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Field, FieldGroup, Money, Sheet, TextInput, timeAgo } from "@/components/ui";
import {
  addExpense,
  clearPendingMutation,
  loadPendingMutation,
  mutationMayHaveCommitted,
  newRequestId,
  savePendingMutation,
} from "@/lib/client";
import { parseMoney } from "@/lib/money";
import type { EventState } from "@/lib/types";

type ExpensePayload = {
  label: string;
  amount: string;
  amountCents: number;
  paidBy: string;
};

const isExpensePayload = (value: unknown): value is ExpensePayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.label === "string" && payload.label.length <= 80 &&
    typeof payload.amount === "string" && payload.amount.length <= 32 &&
    typeof payload.amountCents === "number" &&
    Number.isSafeInteger(payload.amountCents) &&
    payload.amountCents > 0 && payload.amountCents <= 100_000_000 &&
    typeof payload.paidBy === "string" && payload.paidBy.length > 0
  );
};

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
          each purchase stays split across the crew who was in then
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
  const [retryLocked, setRetryLocked] = useState(false);
  const requestId = useRef<string | null>(null);
  const requestPayload = useRef<ExpensePayload | null>(null);

  const me = state.me.memberId;
  const pendingScope = `add-expense:${state.event.id}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const pending = loadPendingMutation(pendingScope, isExpensePayload);
        if (!pending) return;
        requestId.current = pending.requestId;
        requestPayload.current = pending.payload;
        setLabel(pending.payload.label);
        setAmount(pending.payload.amount);
        setPaidBy(pending.payload.paidBy === me ? null : pending.payload.paidBy);
        setRetryLocked(true);
      } catch (err) {
        notify(err instanceof Error ? err.message : "Couldn't restore a saved expense retry.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [me, notify, pendingScope]);

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
      if (!requestId.current || !requestPayload.current) {
        requestId.current = newRequestId();
        requestPayload.current = { label, amount, amountCents: cents, paidBy: payerId };
        savePendingMutation(pendingScope, {
          requestId: requestId.current,
          payload: requestPayload.current,
        });
      }
      const payload = requestPayload.current;
      await addExpense(
        state.event.id,
        payload.label,
        payload.amountCents,
        payload.paidBy,
        requestId.current,
      );
      await refetch();
      setLabel("");
      setAmount("");
      setPaidBy(null);
      requestId.current = null;
      requestPayload.current = null;
      setRetryLocked(false);
      try {
        clearPendingMutation(pendingScope);
      } catch {
        // Retaining the same recovery UUID cannot duplicate the saved expense.
      }
      onClose();
      notify("Logged. Everyone can see it.");
    } catch (err) {
      if (mutationMayHaveCommitted(err)) {
        const payload = requestPayload.current;
        if (payload) {
          setLabel(payload.label);
          setAmount(payload.amount);
          setPaidBy(payload.paidBy === me ? null : payload.paidBy);
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
      notify(err instanceof Error ? err.message : "Couldn't log it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="What got bought?" preventClose={busy}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="The thing">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Cake, balloons, 3 pizzas…"
            maxLength={80}
            required
            disabled={busy || retryLocked}
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
              disabled={busy || retryLocked}
            />
          </div>
        </Field>
        <FieldGroup label="Who paid">
          <div className="flex flex-wrap gap-2">
            {payers.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={payerId === m.id}
                disabled={busy || retryLocked}
                onClick={() => setPaidBy(m.id)}
                className={`min-h-11 rounded-full px-4 text-sm font-bold transition-colors disabled:opacity-50 ${
                  payerId === m.id
                    ? "bg-ink text-void"
                    : "border border-line text-dim"
                }`}
              >
                {m.id === me ? "me" : m.name}
              </button>
            ))}
          </div>
        </FieldGroup>
        {amount && !cents && (
          <p className="text-sm font-bold text-red">
            Amounts look like 12 or 12.50.
          </p>
        )}
        {retryLocked && (
          <p className="text-sm text-dim">
            This may already be logged. Keep these details unchanged and retry
            once to recover the same expense safely.
          </p>
        )}
        <Button full disabled={busy || !cents || !label.trim()}>
          {busy
            ? "Logging…"
            : retryLocked
              ? "Check & retry"
              : cents
                ? `Log it, $${(cents / 100).toFixed(2)}`
                : "Log it"}
        </Button>
      </form>
    </Sheet>
  );
}
