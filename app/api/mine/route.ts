import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deviceIdFrom, jsonError } from "@/lib/server";
import type { MyEventSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Everything this device belongs to. Powers the My Events home screen. */
export async function GET(req: Request) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const { data: mine } = await db()
    .from("members")
    .select("id, event_id, display_name, is_host, status, created_at")
    .eq("device_id", deviceId)
    .in("status", ["active", "pending"])
    .order("created_at", { ascending: false });

  if (!mine?.length) return NextResponse.json({ events: [] });

  const eventIds = mine.map((m) => m.event_id);
  const myMemberIds = mine.map((m) => m.id);

  const [{ data: events }, { data: expenses }, { data: pending }, { data: actives }] =
    await Promise.all([
      db().from("events").select("id, name").in("id", eventIds),
      db().from("expenses").select("event_id, amount_cents").in("event_id", eventIds),
      db()
        .from("settlements")
        .select("id, event_id, to_member")
        .in("to_member", myMemberIds)
        .eq("status", "pending"),
      db()
        .from("members")
        .select("id, event_id")
        .in("event_id", eventIds)
        .eq("status", "active"),
    ]);

  const nameById = new Map((events ?? []).map((e) => [e.id, e.name]));
  const spendByEvent = new Map<string, number>();
  for (const e of expenses ?? []) {
    spendByEvent.set(e.event_id, (spendByEvent.get(e.event_id) ?? 0) + e.amount_cents);
  }
  const pendingByEvent = new Map<string, number>();
  for (const s of pending ?? []) {
    pendingByEvent.set(s.event_id, (pendingByEvent.get(s.event_id) ?? 0) + 1);
  }
  const activeByEvent = new Map<string, number>();
  for (const m of actives ?? []) {
    activeByEvent.set(m.event_id, (activeByEvent.get(m.event_id) ?? 0) + 1);
  }

  const out: MyEventSummary[] = mine
    .filter((m) => nameById.has(m.event_id))
    .map((m) => ({
      eventId: m.event_id,
      eventName: nameById.get(m.event_id)!,
      myName: m.display_name,
      myStatus: m.status,
      isHost: m.is_host,
      activeCount: activeByEvent.get(m.event_id) ?? 0,
      totalSpentCents: spendByEvent.get(m.event_id) ?? 0,
      pendingForMe: pendingByEvent.get(m.event_id) ?? 0,
    }));

  return NextResponse.json({ events: out });
}
