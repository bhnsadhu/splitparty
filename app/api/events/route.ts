import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  cleanName,
  deviceIdFrom,
  jsonError,
  newJoinCode,
  readJson,
} from "@/lib/server";

export async function POST(req: Request) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return jsonError(401, "Missing device identity.");

  const body = await readJson<{ eventName?: string; displayName?: string }>(req);
  const eventName = cleanName(body?.eventName, 60);
  const displayName = cleanName(body?.displayName, 40);
  if (!eventName) return jsonError(400, "Give the event a name.");
  if (!displayName) return jsonError(400, "Tell us what to call you.");

  // Retry on the (rare) code collision instead of failing the party.
  let event: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 6 && !event; attempt++) {
    const { data, error } = await db()
      .from("events")
      .insert({ name: eventName, code: newJoinCode() })
      .select("id, code")
      .single();
    if (data) event = data;
    else if (error && error.code !== "23505") {
      return jsonError(500, "Couldn't create the event. Try again.");
    }
  }
  if (!event) return jsonError(500, "Couldn't create the event. Try again.");

  const { error: memberErr } = await db().from("members").insert({
    event_id: event.id,
    device_id: deviceId,
    display_name: displayName,
    is_host: true,
    status: "active",
  });
  if (memberErr) {
    await db().from("events").delete().eq("id", event.id);
    return jsonError(500, "Couldn't create the event. Try again.");
  }

  return NextResponse.json({ eventId: event.id, code: event.code });
}
