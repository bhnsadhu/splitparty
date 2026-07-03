import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deviceIdFrom, jsonError, memberFor, type MemberRow } from "@/lib/server";
import { computeLedger } from "@/lib/settle";
import type { EventState, RestrictedState } from "@/lib/types";

export const dynamic = "force-dynamic";

interface ExpenseRow {
  id: string;
  paid_by: string;
  created_by: string;
  label: string;
  amount_cents: number;
  created_at: string;
}
interface SettlementRow {
  id: string;
  from_member: string;
  to_member: string;
  amount_cents: number;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
  resolved_at: string | null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const me = await memberFor(eventId, deviceId);
  if (!me) return jsonError(404, "You're not in this event.");

  const [{ data: event }, { data: memberRows }, { data: settlementRows }] =
    await Promise.all([
      db().from("events").select("id, name, code, currency").eq("id", eventId).single(),
      db().from("members").select("*").eq("event_id", eventId).order("created_at"),
      db()
        .from("settlements")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false }),
    ]);
  if (!event || !memberRows) return jsonError(404, "Event not found.");

  const members = memberRows as MemberRow[];
  const settlements = (settlementRows ?? []) as SettlementRow[];

  const meOut = {
    memberId: me.id,
    name: me.display_name,
    isHost: me.is_host,
    status: me.status,
  };

  if (me.status !== "active") {
    // Outside the room you see nothing financial — except payments waiting on
    // YOUR confirmation, so someone who left can still close out their ledger.
    const host = members.find((m) => m.is_host);
    const myPending = settlements.filter(
      (s) => s.to_member === me.id && s.status === "pending",
    );
    const names = new Map(members.map((m) => [m.id, m.display_name]));
    const restricted: RestrictedState & {
      pendingConfirmations: { id: string; fromName: string; amountCents: number }[];
    } = {
      restricted: true,
      event: { id: event.id, name: event.name },
      me: meOut,
      hostName: host?.display_name ?? "the host",
      pendingConfirmations: myPending.map((s) => ({
        id: s.id,
        fromName: names.get(s.from_member) ?? "Someone",
        amountCents: s.amount_cents,
      })),
    };
    return NextResponse.json(restricted);
  }

  const { data: expenseRows } = await db()
    .from("expenses")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  const expenses = (expenseRows ?? []) as ExpenseRow[];

  const ledger = computeLedger(members, expenses, settlements);

  // Members list shown to the room: everyone current, plus exited members who
  // still appear in money history (their names must stay resolvable).
  const referenced = new Set<string>();
  for (const e of expenses) {
    referenced.add(e.paid_by);
    referenced.add(e.created_by);
  }
  for (const s of settlements) {
    referenced.add(s.from_member);
    referenced.add(s.to_member);
  }
  const visibleMembers = members.filter(
    (m) => m.status === "active" || m.status === "pending" || referenced.has(m.id),
  );

  const state: EventState = {
    restricted: false,
    event,
    me: meOut,
    members: visibleMembers.map((m) => ({
      id: m.id,
      name: m.display_name,
      isHost: m.is_host,
      status: m.status,
      joinedAt: m.created_at,
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      label: e.label,
      amountCents: e.amount_cents,
      paidBy: e.paid_by,
      createdBy: e.created_by,
      createdAt: e.created_at,
    })),
    settlements: settlements.map((s) => ({
      id: s.id,
      from: s.from_member,
      to: s.to_member,
      amountCents: s.amount_cents,
      status: s.status,
      createdAt: s.created_at,
      resolvedAt: s.resolved_at,
    })),
    balances: ledger.balances,
    transfers: ledger.transfers,
    totalSpentCents: ledger.totalSpentCents,
    pendingForMe: settlements.filter(
      (s) => s.to_member === me.id && s.status === "pending",
    ).length,
  };
  return NextResponse.json(state);
}
