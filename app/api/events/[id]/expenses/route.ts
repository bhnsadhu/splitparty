import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  cleanName,
  deviceIdFrom,
  jsonError,
  memberFor,
  readJson,
  validAmount,
} from "@/lib/server";

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

  const body = await readJson<{
    label?: string;
    amountCents?: number;
    paidBy?: string;
  }>(req);
  const label = cleanName(body?.label, 80);
  if (!label) return jsonError(400, "What was it? Give it a name.");
  if (!validAmount(body?.amountCents)) return jsonError(400, "Enter a real amount.");

  const paidBy = body?.paidBy ?? me.id;
  if (paidBy !== me.id) {
    const { data: payer } = await db()
      .from("members")
      .select("id, status")
      .eq("id", paidBy)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!payer || payer.status !== "active") {
      return jsonError(400, "That payer isn't active in this event.");
    }
  }

  const { data, error } = await db()
    .from("expenses")
    .insert({
      event_id: eventId,
      paid_by: paidBy,
      created_by: me.id,
      label,
      amount_cents: body!.amountCents,
    })
    .select("id")
    .single();
  if (error || !data) return jsonError(500, "Couldn't log it. Try again.");
  return NextResponse.json({ ok: true, id: data.id });
}
