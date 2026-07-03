import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deviceIdFrom, jsonError, memberFor, readJson } from "@/lib/server";

type Action = "confirm" | "reject" | "cancel";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id: eventId, sid } = await params;
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const me = await memberFor(eventId, deviceId);
  if (!me) return jsonError(403, "You're not in this event.");

  const body = await readJson<{ action?: Action }>(req);
  const action = body?.action;

  // Every branch guards on status='pending' so a double-tap or a race between
  // two phones resolves to exactly one outcome.
  if (action === "confirm" || action === "reject") {
    // Receiver-only. Works even if the receiver has left — money owed to them
    // is still theirs to confirm.
    const { data, error } = await db()
      .from("settlements")
      .update({
        status: action === "confirm" ? "confirmed" : "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", sid)
      .eq("event_id", eventId)
      .eq("to_member", me.id)
      .eq("status", "pending")
      .select("id");
    if (error) return jsonError(500, "Couldn't update that. Try again.");
    if (!data?.length) return jsonError(409, "Already handled, or not yours to confirm.");
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    const { data, error } = await db()
      .from("settlements")
      .delete()
      .eq("id", sid)
      .eq("event_id", eventId)
      .eq("from_member", me.id)
      .eq("status", "pending")
      .select("id");
    if (error) return jsonError(500, "Couldn't cancel that. Try again.");
    if (!data?.length) return jsonError(409, "Already handled.");
    return NextResponse.json({ ok: true });
  }

  return jsonError(400, "Unknown action.");
}
