"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar, Button, Chip, Money, timeAgo } from "@/components/ui";
import { api } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import type { EventState, MemberPub } from "@/lib/types";

export default function CrewTab({
  state,
  refetch,
  notify,
  openTicket,
}: {
  state: EventState;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
  openTicket: () => void;
}) {
  const router = useRouter();
  const me = state.me.memberId;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const balanceById = useMemo(
    () => new Map(state.balances.map((b) => [b.memberId, b])),
    [state.balances],
  );
  const nameById = useMemo(
    () => new Map(state.members.map((m) => [m.id, m.name])),
    [state.members],
  );
  const name = (id: string) => (id === me ? "you" : (nameById.get(id) ?? "someone"));

  const atTheDoor = state.members.filter((m) => m.status === "pending");
  const roster = state.members
    .filter((m) => m.status !== "pending")
    .sort((a, b) => {
      const rank = (m: MemberPub) =>
        m.status !== "active" ? 2 : m.isHost ? 0 : 1;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  async function memberAction(
    memberId: string,
    action: "approve" | "deny" | "remove" | "leave",
  ) {
    setBusyId(memberId);
    try {
      await api(`/api/events/${state.event.id}/members/${memberId}`, { action });
      if (action === "leave") {
        notify("You're out. Settled history stays put.");
        router.push("/");
        return;
      }
      await refetch();
      if (action === "approve") notify("They're in.");
      if (action === "deny") notify("Denied.");
      if (action === "remove") notify("Removed. Their settled history stays.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setBusyId(null);
      setArmed(null);
    }
  }

  function arm(id: string, fn: () => void) {
    if (armed === id) {
      fn();
    } else {
      setArmed(id);
      window.setTimeout(() => setArmed((a) => (a === id ? null : a)), 3000);
    }
  }

  return (
    <div className="fade-in space-y-8">
      {/* ---- Join requests (host only) ---- */}
      {state.me.isHost && atTheDoor.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-faint">
            At the door
          </h3>
          <div className="space-y-3">
            {atTheDoor.map((m) => (
              <div
                key={m.id}
                className="rounded-2xl border border-line bg-surface p-4"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink">{m.name}</p>
                    <p className="text-xs text-faint">
                      knocked{" "}
                      {timeAgo(m.joinedAt) === "now"
                        ? "just now"
                        : `${timeAgo(m.joinedAt)} ago`}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    small
                    disabled={busyId === m.id}
                    onClick={() => memberAction(m.id, "approve")}
                  >
                    Let them in
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    disabled={busyId === m.id}
                    onClick={() => memberAction(m.id, "deny")}
                  >
                    Not tonight
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!state.me.isHost && atTheDoor.length > 0 && (
        <p className="text-sm text-faint">
          {atTheDoor.length} {atTheDoor.length === 1 ? "person is" : "people are"} at
          the door waiting on the host.
        </p>
      )}

      {/* ---- Roster ---- */}
      <section>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-faint">
          The crew · {roster.filter((m) => m.status === "active").length} in
        </h3>
        <ul className="space-y-1">
          {roster.map((m) => {
            const b = balanceById.get(m.id);
            const net = b?.netCents ?? 0;
            const ghost = m.status !== "active";
            const isOpen = expanded === m.id;
            return (
              <li key={m.id} className="rounded-2xl border border-transparent bg-transparent">
                <button
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left"
                  onClick={() => setExpanded(isOpen ? null : m.id)}
                  aria-expanded={isOpen}
                >
                  <Avatar name={m.name} dim={ghost} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-bold ${ghost ? "text-faint" : "text-ink"}`}>
                      {m.name}
                      {m.id === me && <span className="text-faint"> (you)</span>}
                    </p>
                    <p className="text-xs text-faint">
                      {m.isHost && "host · "}
                      {ghost && `${m.status} · `}
                      paid {formatMoney(b?.paidCents ?? 0)}
                    </p>
                  </div>
                  {net > 0 ? (
                    <Chip tone="red">+{formatMoney(net)}</Chip>
                  ) : net < 0 ? (
                    <Chip tone="red">-{formatMoney(-net)}</Chip>
                  ) : (
                    <Chip tone="green">square</Chip>
                  )}
                </button>

                {isOpen && (
                  <div className="fade-in mb-2 ml-14 mr-2 space-y-2 border-l border-line pl-4 text-sm text-dim">
                    {b ? (
                      <>
                        <p>
                          paid <Money cents={b.paidCents} className="font-bold" /> · share{" "}
                          <Money cents={b.shareCents} className="font-bold" />
                          {b.sentCents > 0 && (
                            <> · paid back <Money cents={b.sentCents} className="font-bold" /></>
                          )}
                          {b.recvCents > 0 && (
                            <> · received <Money cents={b.recvCents} className="font-bold" /></>
                          )}
                        </p>
                        {state.transfers
                          .filter((t) => t.from === m.id || t.to === m.id)
                          .map((t, i) => (
                            <p key={i}>
                              {t.from === m.id ? (
                                <>owes <span className="font-bold">{name(t.to)}</span></>
                              ) : (
                                <>gets <span className="font-bold text-red">{formatMoney(t.amountCents)}</span> from{" "}
                                  <span className="font-bold">{name(t.from)}</span></>
                              )}
                              {t.from === m.id && (
                                <> <Money cents={t.amountCents} className="font-bold text-red" /></>
                              )}
                            </p>
                          ))}
                        {net === 0 && <p className="text-green">all square ✓</p>}
                      </>
                    ) : (
                      <p>no money activity</p>
                    )}

                    {state.me.isHost && !m.isHost && m.status === "active" && (
                      <Button
                        small
                        variant="danger"
                        disabled={busyId === m.id}
                        onClick={() => arm(`remove-${m.id}`, () => memberAction(m.id, "remove"))}
                      >
                        {armed === `remove-${m.id}`
                          ? `Sure? Remove ${m.name}`
                          : "Remove from party"}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Ticket + leave ---- */}
      <section className="space-y-3">
        <Button variant="quiet" full onClick={openTicket}>
          Show the ticket · code {state.event.code}
        </Button>
        {!state.me.isHost && (
          <Button
            variant="danger"
            full
            disabled={busyId === me}
            onClick={() => arm("leave", () => memberAction(me, "leave"))}
          >
            {armed === "leave" ? "Sure? Your settled history stays" : "Leave this party"}
          </Button>
        )}
      </section>
    </div>
  );
}
