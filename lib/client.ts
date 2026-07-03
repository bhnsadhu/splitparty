"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StateResponse } from "./types";

const DEVICE_KEY = "sp_device_id";

/** Stable anonymous identity for this browser. No login, no password. */
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

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-device-id": getDeviceId(),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? "Something broke. Try again.");
  }
  return data as T;
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
      const data = await api<StateResponse>(`/api/events/${eventId}/state`);
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
