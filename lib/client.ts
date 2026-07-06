"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeLedger } from "./settle";
import { supabase } from "./supabase";
import type {
  EventState,
  ExpensePub,
  MemberPub,
  MyEventSummary,
  RestrictedState,
  SettlementPub,
  StateResponse,
} from "./types";

const DEVICE_KEY = "sp_device_id";
export const HOME_CACHE_KEY = "sp_home_cache";

/** Stable anonymous identity for this device. No login, no password. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every server round-trip is one Postgres RPC; the device id is the credential. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, {
    p_device_id: getDeviceId(),
    ...args,
  });
  if (error) {
    // PostgREST surfaces our `raise exception` messages verbatim; anything
    // else (network, outage) gets the generic line.
    const friendly =
      error.code && error.code.startsWith("P0")
        ? error.message
        : (error.message ?? "Something broke. Try again.");
    throw new ApiError(400, friendly);
  }
  return data as T;
}

export function createEvent(eventName: string, displayName: string) {
  return rpc<{ eventId: string; code: string }>("sp_create_event", {
    p_event_name: eventName,
    p_display_name: displayName,
  });
}

export function joinEvent(code: string, displayName: string) {
  return rpc<{ eventId: string; status: string; guest?: boolean }>("sp_join_event", {
    p_code: code,
    p_display_name: displayName,
  });
}

export function myEvents() {
  return rpc<MyEventSummary[]>("sp_my_events", {});
}

export function addExpense(
  eventId: string,
  label: string,
  amountCents: number,
  paidBy: string,
) {
  return rpc<{ ok: true; id: string }>("sp_add_expense", {
    p_event_id: eventId,
    p_label: label,
    p_amount_cents: amountCents,
    p_paid_by: paidBy,
  });
}

export function createSettlement(eventId: string, toMemberId: string, amountCents: number) {
  return rpc<{ ok: true; id: string }>("sp_create_settlement", {
    p_event_id: eventId,
    p_to_member: toMemberId,
    p_amount_cents: amountCents,
  });
}

export function resolveSettlement(
  eventId: string,
  settlementId: string,
  action: "confirm" | "reject" | "cancel",
) {
  return rpc<{ ok: true }>("sp_resolve_settlement", {
    p_event_id: eventId,
    p_settlement_id: settlementId,
    p_action: action,
  });
}

export function memberAction(
  eventId: string,
  memberId: string,
  action: "approve" | "deny" | "remove" | "leave" | "rerequest",
) {
  return rpc<{ ok: true }>("sp_member_action", {
    p_event_id: eventId,
    p_member_id: memberId,
    p_action: action,
  });
}

/** Server-side wipe of everything tied to this device, then local reset. */
export async function deleteMyData(): Promise<void> {
  await rpc<{ ok: true }>("sp_delete_my_data", {});
  localStorage.removeItem(DEVICE_KEY);
  localStorage.removeItem(HOME_CACHE_KEY);
}

interface RawState {
  notMember?: boolean;
  restricted?: boolean;
  event: EventState["event"];
  me: EventState["me"];
  hostName?: string;
  pendingConfirmations?: { id: string; fromName: string; amountCents: number }[];
  members?: MemberPub[];
  expenses?: ExpensePub[];
  settlements?: SettlementPub[];
}

/** The ledger math runs on-device; the RPC only ships raw rows (no device ids). */
async function fetchState(eventId: string): Promise<StateResponse> {
  const raw = await rpc<RawState>("sp_event_state", { p_event_id: eventId });
  if (raw.notMember) throw new ApiError(404, "You're not in this event.");

  if (raw.restricted) {
    const restricted: RestrictedState & {
      pendingConfirmations: { id: string; fromName: string; amountCents: number }[];
    } = {
      restricted: true,
      event: raw.event,
      me: raw.me,
      hostName: raw.hostName ?? "the host",
      pendingConfirmations: raw.pendingConfirmations ?? [],
    };
    return restricted;
  }

  const members = raw.members ?? [];
  const expenses = raw.expenses ?? [];
  const settlements = raw.settlements ?? [];
  const ledger = computeLedger(members, expenses, settlements);

  // Members list shown to the room: everyone current, plus exited members who
  // still appear in money history (their names must stay resolvable).
  const referenced = new Set<string>();
  for (const e of expenses) {
    referenced.add(e.paidBy);
    referenced.add(e.createdBy);
  }
  for (const s of settlements) {
    referenced.add(s.from);
    referenced.add(s.to);
  }

  return {
    restricted: false,
    event: raw.event,
    me: raw.me,
    members: members.filter(
      (m) => m.status === "active" || m.status === "pending" || referenced.has(m.id),
    ),
    expenses,
    settlements,
    balances: ledger.balances,
    transfers: ledger.transfers,
    totalSpentCents: ledger.totalSpentCents,
    pendingForMe: settlements.filter(
      (s) => s.to === raw.me.memberId && s.status === "pending",
    ).length,
  };
}

const POLL_MS = 3000;

/**
 * Live event state. Polls every few seconds while the tab is visible,
 * refetches instantly on focus and after any mutation (call refetch()).
 */
export function useEventState(eventId: string) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await fetchState(eventId);
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "Network hiccup."));
    } finally {
      inFlight.current = false;
    }
  }, [eventId]);

  useEffect(() => {
    refetch();
    const tick = setInterval(() => {
      if (!document.hidden) refetch();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  return { state, error, refetch };
}
