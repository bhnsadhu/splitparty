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
const PENDING_MUTATION_PREFIX = "sp_pending_mutation:";
export const HOME_CACHE_KEY = "sp_home_cache";
export const REQUEST_TIMEOUT_MS = 12_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ApiErrorKind =
  | "offline"
  | "timeout"
  | "storage"
  | "unavailable"
  | "request";

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;

  constructor(status: number, message: string, kind: ApiErrorKind = "request") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }
}

/** True when a failed response cannot prove that the server rolled back. */
export function mutationMayHaveCommitted(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.kind === "timeout" ||
    error.kind === "unavailable"
  );
}

export interface PendingMutation<T> {
  requestId: string;
  payload: T;
}

function pendingMutationKey(scope: string): string {
  return `${PENDING_MUTATION_PREFIX}${scope}`;
}

/** Persist one uncertain mutation so reload/relaunch retries reuse its UUID. */
export function savePendingMutation<T>(
  scope: string,
  pending: PendingMutation<T>,
): void {
  try {
    localStorage.setItem(
      pendingMutationKey(scope),
      JSON.stringify({ ...pending, deviceId: getDeviceId() }),
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "SplitParty can't save a safe retry on this device. Check your privacy settings and try again.",
      "storage",
    );
  }
}

export function loadPendingMutation<T>(
  scope: string,
  isPayload: (value: unknown) => value is T,
): PendingMutation<T> | null {
  const key = pendingMutationKey(scope);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem(key);
      return null;
    }
    if (!parsed || typeof parsed !== "object") {
      localStorage.removeItem(key);
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.deviceId !== getDeviceId() ||
      typeof record.requestId !== "string" ||
      !UUID_PATTERN.test(record.requestId) ||
      !isPayload(record.payload)
    ) {
      localStorage.removeItem(key);
      return null;
    }
    return { requestId: record.requestId, payload: record.payload };
  } catch (error) {
    try {
      localStorage.removeItem(key);
    } catch {
      // The user-facing storage error below is the actionable result.
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "SplitParty can't read a saved retry on this device. Check your privacy settings and try again.",
      "storage",
    );
  }
}

export function clearPendingMutation(scope: string): void {
  try {
    localStorage.removeItem(pendingMutationKey(scope));
  } catch {
    throw new ApiError(
      0,
      "SplitParty couldn't clear a saved retry on this device. Close and reopen the app before trying again.",
      "storage",
    );
  }
}

function clearAllPendingMutations(): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(PENDING_MUTATION_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}

function newDeviceId(): string {
  const webCrypto = globalThis.crypto as unknown as
    | {
        randomUUID?: () => string;
        getRandomValues?: (array: Uint8Array) => Uint8Array;
      }
    | undefined;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join(""),
    ].join("-");
  }
  throw new ApiError(
    0,
    "This device can't create a private party identity. Update iOS and try again.",
    "storage",
  );
}

/** A cryptographically random idempotency key for one user-initiated mutation. */
export function newRequestId(): string {
  return newDeviceId();
}

/** Stable anonymous identity for this device. No login, no password. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = newDeviceId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      "SplitParty can't access storage on this device. Check your privacy settings and try again.",
      "storage",
    );
  }
}

export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

export interface RpcResult<T> {
  data: T | null;
  error: RpcErrorLike | null;
}

/** Convert backend details into a small, safe set of messages for the UI. */
export function apiErrorFromResponse(error: RpcErrorLike): ApiError {
  // P0001 is raised deliberately by the sp_* RPCs with user-facing copy.
  if (error.code === "P0001" && error.message) {
    return new ApiError(400, error.message, "request");
  }

  return new ApiError(
    503,
    "SplitParty couldn't reach the party service. Try again.",
    "unavailable",
  );
}

/**
 * Execute one request with a hard deadline. Exported so failure behavior can
 * be verified without calling production or mocking the Supabase client.
 */
export async function runRpcRequest<T>(
  perform: (signal: AbortSignal) => PromiseLike<RpcResult<T>>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = globalThis.setTimeout(() => {
      controller.abort();
      reject(
        new ApiError(
          408,
          "This is taking longer than expected. Check your connection and try again.",
          "timeout",
        ),
      );
    }, timeoutMs);
  });

  try {
    const { data, error } = await Promise.race([
      Promise.resolve(perform(controller.signal)),
      deadline,
    ]);
    if (controller.signal.aborted) {
      throw new ApiError(
        408,
        "This is taking longer than expected. Check your connection and try again.",
        "timeout",
      );
    }
    if (error) throw apiErrorFromResponse(error);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ApiError(
        408,
        "This is taking longer than expected. Check your connection and try again.",
        "timeout",
      );
    }
    throw new ApiError(
      0,
      "Couldn't connect to SplitParty. Check your connection and try again.",
      "unavailable",
    );
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

/** Every server round-trip is one Postgres RPC; the device id is the credential. */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ApiError(
      0,
      "You're offline. Reconnect, then try again.",
      "offline",
    );
  }

  return runRpcRequest<T>((signal) =>
    supabase()
      .rpc(fn, {
        p_device_id: getDeviceId(),
        ...args,
      })
      .abortSignal(signal),
  );
}

export function createEvent(eventName: string, displayName: string, requestId: string) {
  return rpc<{ eventId: string; code: string }>("sp_create_event", {
    p_event_name: eventName,
    p_display_name: displayName,
    p_request_id: requestId,
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
  requestId: string,
) {
  return rpc<{ ok: true; id: string }>("sp_add_expense", {
    p_event_id: eventId,
    p_label: label,
    p_amount_cents: amountCents,
    p_paid_by: paidBy,
    p_request_id: requestId,
  });
}

export function createSettlement(
  eventId: string,
  toMemberId: string,
  amountCents: number,
  requestId: string,
) {
  return rpc<{ ok: true; id: string }>("sp_create_settlement", {
    p_event_id: eventId,
    p_to_member: toMemberId,
    p_amount_cents: amountCents,
    p_request_id: requestId,
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

export function deleteEvent(eventId: string) {
  return rpc<{ ok: true }>("sp_delete_event", { p_event_id: eventId });
}

/** Server-side wipe of everything tied to this device, then local reset. */
export async function deleteMyData(): Promise<void> {
  await rpc<{ ok: true }>("sp_delete_my_data", {});
  clearAllPendingMutations();
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
    for (const participantId of e.participantIds ?? []) referenced.add(participantId);
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
      (m) =>
        m.status === "active" ||
        (m.status === "pending" && (raw.me.isHost || referenced.has(m.id))) ||
        referenced.has(m.id),
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
  const [result, setResult] = useState<{ eventId: string; state: StateResponse } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ eventId: string; error: ApiError } | null>(
    null,
  );
  const [refreshingEventId, setRefreshingEventId] = useState<string | null>(null);
  const inFlight = useRef<{
    eventId: string;
    token: symbol;
    promise: Promise<void>;
  } | null>(null);

  const load = useCallback((force = false): Promise<void> => {
    if (!force && inFlight.current?.eventId === eventId) {
      return inFlight.current.promise;
    }

    const token = Symbol(eventId);
    setRefreshingEventId(eventId);

    const promise = fetchState(eventId)
      .then((data) => {
        if (inFlight.current?.token !== token) return;
        setResult({ eventId, state: data });
        setFailure((current) => (current?.eventId === eventId ? null : current));
      })
      .catch((error: unknown) => {
        if (inFlight.current?.token !== token) return;
        setFailure({
          eventId,
          error:
            error instanceof ApiError
              ? error
              : new ApiError(
                  0,
                  "Couldn't connect to SplitParty. Check your connection and try again.",
                  "unavailable",
                ),
        });
      })
      .finally(() => {
        if (inFlight.current?.token === token) {
          inFlight.current = null;
          setRefreshingEventId((current) => (current === eventId ? null : current));
        }
      });

    inFlight.current = { eventId, token, promise };
    return promise;
  }, [eventId]);

  // User retries and post-mutation refreshes must start after the mutation,
  // even when an older background poll for this event is still in flight.
  const refetch = useCallback(() => load(true), [load]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const tick = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  return {
    state: result?.eventId === eventId ? result.state : null,
    error: failure?.eventId === eventId ? failure.error : null,
    isRefreshing: refreshingEventId === eventId,
    refetch,
  };
}
