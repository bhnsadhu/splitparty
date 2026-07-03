import { NextResponse } from "next/server";
import { db } from "./db";
import { MAX_AMOUNT_CENTS } from "./money";
import type { MemberStatus } from "./types";

export interface MemberRow {
  id: string;
  event_id: string;
  device_id: string;
  display_name: string;
  is_host: boolean;
  status: MemberStatus;
  created_at: string;
}

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Anonymous device identity — the only credential this app has. */
export function deviceIdFrom(req: Request): string | null {
  const id = req.headers.get("x-device-id");
  if (!id || !/^[A-Za-z0-9-]{10,64}$/.test(id)) return null;
  return id;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// No 0/O, 1/I/L — codes get read out loud across a noisy room.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export function newJoinCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function cleanName(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > max) return null;
  return name;
}

export function validAmount(cents: unknown): cents is number {
  return (
    typeof cents === "number" &&
    Number.isInteger(cents) &&
    cents > 0 &&
    cents <= MAX_AMOUNT_CENTS
  );
}

export async function memberFor(
  eventId: string,
  deviceId: string,
): Promise<MemberRow | null> {
  const { data } = await db()
    .from("members")
    .select("*")
    .eq("event_id", eventId)
    .eq("device_id", deviceId)
    .maybeSingle();
  return (data as MemberRow) ?? null;
}

/** Pending (unconfirmed) settlements vanish when a member exits — confirmed history never does. */
export async function deletePendingSettlementsInvolving(
  eventId: string,
  memberId: string,
) {
  await db()
    .from("settlements")
    .delete()
    .eq("event_id", eventId)
    .eq("status", "pending")
    .or(`from_member.eq.${memberId},to_member.eq.${memberId}`);
}
