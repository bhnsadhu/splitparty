import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  cleanName,
  deviceIdFrom,
  jsonError,
  memberFor,
  normalizeCode,
  readJson,
} from "@/lib/server";

export async function POST(req: Request) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const body = await readJson<{ code?: string; displayName?: string }>(req);
  const code = normalizeCode(body?.code ?? "");
  const displayName = cleanName(body?.displayName, 40);
  if (code.length < 4) return jsonError(400, "That code doesn't look right.");
  if (!displayName) return jsonError(400, "Tell us what to call you.");

  const { data: event } = await db()
    .from("events")
    .select("id, name")
    .eq("code", code)
    .maybeSingle();
  if (!event) return jsonError(404, "No party with that code. Check it and try again.");

  const existing = await memberFor(event.id, deviceId);

  if (!existing) {
    const { error } = await db().from("members").insert({
      event_id: event.id,
      device_id: deviceId,
      display_name: displayName,
      status: "pending",
    });
    if (error) return jsonError(500, "Couldn't send your request. Try again.");
    return NextResponse.json({ eventId: event.id, status: "pending" });
  }

  if (existing.status === "active") {
    return NextResponse.json({ eventId: event.id, status: "active" });
  }

  // Pending, left, removed, or denied: (re)ask the host, keeping the same
  // member row so any confirmed history reconnects to the same person.
  const { error } = await db()
    .from("members")
    .update({ status: "pending", display_name: displayName })
    .eq("id", existing.id);
  if (error) return jsonError(500, "Couldn't send your request. Try again.");
  return NextResponse.json({ eventId: event.id, status: "pending" });
}
