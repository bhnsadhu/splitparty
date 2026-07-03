import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  deletePendingSettlementsInvolving,
  deviceIdFrom,
  jsonError,
  memberFor,
  readJson,
  type MemberRow,
} from "@/lib/server";

type Action = "approve" | "deny" | "remove" | "leave" | "rerequest";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; mid: string }> },
) {
  const { id: eventId, mid } = await params;
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const me = await memberFor(eventId, deviceId);
  if (!me) return jsonError(403, "You're not in this event.");

  const body = await readJson<{ action?: Action }>(req);
  const action = body?.action;

  const { data: targetRow } = await db()
    .from("members")
    .select("*")
    .eq("id", mid)
    .eq("event_id", eventId)
    .maybeSingle();
  const target = targetRow as MemberRow | null;
  if (!target) return jsonError(404, "No such member.");

  if (action === "approve" || action === "deny") {
    if (!me.is_host || me.status !== "active") {
      return jsonError(403, "Only the host can do that.");
    }
    // Guard on status so approve/deny races settle to one outcome.
    const { data } = await db()
      .from("members")
      .update({ status: action === "approve" ? "active" : "denied" })
      .eq("id", target.id)
      .eq("status", "pending")
      .select("id");
    if (!data?.length) return jsonError(409, "Already handled.");
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    if (!me.is_host || me.status !== "active") {
      return jsonError(403, "Only the host can do that.");
    }
    if (target.is_host) return jsonError(400, "The host can't be removed.");
    const { data } = await db()
      .from("members")
      .update({ status: "removed" })
      .eq("id", target.id)
      .eq("status", "active")
      .select("id");
    if (!data?.length) return jsonError(409, "Already handled.");
    // Their unconfirmed claims go; their paid expenses and confirmed history stay.
    await deletePendingSettlementsInvolving(eventId, target.id);
    return NextResponse.json({ ok: true });
  }

  if (action === "leave") {
    if (target.id !== me.id) return jsonError(403, "You can only remove yourself.");
    if (me.is_host) {
      return jsonError(400, "Hosts can't leave their own party, it would strand everyone.");
    }
    if (me.status !== "active" && me.status !== "pending") {
      return jsonError(409, "You're already out.");
    }
    await db().from("members").update({ status: "left" }).eq("id", me.id);
    await deletePendingSettlementsInvolving(eventId, me.id);
    return NextResponse.json({ ok: true });
  }

  if (action === "rerequest") {
    if (target.id !== me.id) return jsonError(403, "Not yours.");
    if (!["left", "removed", "denied"].includes(me.status)) {
      return jsonError(409, "Nothing to re-request.");
    }
    await db().from("members").update({ status: "pending" }).eq("id", me.id);
    return NextResponse.json({ ok: true });
  }

  return jsonError(400, "Unknown action.");
}
