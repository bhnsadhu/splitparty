import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  deviceIdFrom,
  jsonError,
  memberFor,
  readJson,
  validAmount,
} from "@/lib/server";

/** "I paid [name] $X" — creates a PENDING claim only the receiver can confirm. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const me = await memberFor(eventId, deviceId);
  if (!me || me.status !== "active") {
    return jsonError(403, "You're not active in this event.");
  }

  const body = await readJson<{ toMemberId?: string; amountCents?: number }>(req);
  if (!validAmount(body?.amountCents)) return jsonError(400, "Enter a real amount.");
  if (!body?.toMemberId || body.toMemberId === me.id) {
    return jsonError(400, "Pick who you paid.");
  }

  const { data: receiver } = await db()
    .from("members")
    .select("id, status")
    .eq("id", body.toMemberId)
    .eq("event_id", eventId)
    .maybeSingle();
  // You can pay back someone who already left — their ledger line survives
  // until it's square. Only never-approved members are off the table.
  if (!receiver || receiver.status === "pending" || receiver.status === "denied") {
    return jsonError(400, "They're not part of this event yet.");
  }

  // Round-trip the created row so a silently dropped insert can never
  // masquerade as success — this claim is money, it must be provably stored.
  const { data, error } = await db()
    .from("settlements")
    .insert({
      event_id: eventId,
      from_member: me.id,
      to_member: receiver.id,
      amount_cents: body.amountCents,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) return jsonError(500, "Couldn't record that. Try again.");
  return NextResponse.json({ ok: true, id: data.id });
}
