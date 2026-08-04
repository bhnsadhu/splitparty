"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Field, TextInput, Wordmark } from "@/components/ui";
import {
  clearPendingMutation,
  createEvent,
  loadPendingMutation,
  mutationMayHaveCommitted,
  newRequestId,
  savePendingMutation,
} from "@/lib/client";
import {
  isCreateEventPayload,
  type CreateEventPayload,
} from "@/lib/recovery";

const CREATE_PENDING_SCOPE = "create-event";

export default function NewEvent() {
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryLocked, setRetryLocked] = useState(false);
  const requestId = useRef<string | null>(null);
  const requestPayload = useRef<CreateEventPayload | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const pending = loadPendingMutation(CREATE_PENDING_SCOPE, isCreateEventPayload);
        if (!pending) return;
        requestId.current = pending.requestId;
        requestPayload.current = pending.payload;
        setEventName(pending.payload.eventName);
        setDisplayName(pending.payload.displayName);
        setRetryLocked(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't restore a saved retry.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!requestId.current || !requestPayload.current) {
        requestId.current = newRequestId();
        requestPayload.current = { eventName, displayName };
        savePendingMutation(CREATE_PENDING_SCOPE, {
          requestId: requestId.current,
          payload: requestPayload.current,
        });
      }
      const payload = requestPayload.current;
      const { eventId } = await createEvent(
        payload.eventName,
        payload.displayName,
        requestId.current,
      );
      try {
        clearPendingMutation(CREATE_PENDING_SCOPE);
      } catch {
        // A retained recovery record is safe: the same request remains idempotent.
      }
      router.push(`/e?id=${eventId}&welcome=1`);
    } catch (err) {
      if (mutationMayHaveCommitted(err)) {
        const payload = requestPayload.current;
        if (payload) {
          setEventName(payload.eventName);
          setDisplayName(payload.displayName);
        }
        setRetryLocked(true);
      } else {
        try {
          clearPendingMutation(CREATE_PENDING_SCOPE);
          requestId.current = null;
          requestPayload.current = null;
          setRetryLocked(false);
        } catch {
          setRetryLocked(true);
        }
      }
      setError(err instanceof Error ? err.message : "Something broke. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-bold text-dim">
          ← back
        </Link>
        <Wordmark />
      </header>

      <h1 className="font-display text-3xl font-black leading-tight text-ink">
        Start a party
      </h1>
      <p className="mt-2 text-dim">
        You&rsquo;ll get a code. Anyone with the code can ask in. You decide who
        gets through the door.
      </p>

      <form onSubmit={create} className="mt-8 space-y-5">
        <Field label="What's the occasion?">
          <TextInput
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Sam's Surprise Party"
            maxLength={60}
            autoFocus
            required
            disabled={busy || retryLocked}
          />
        </Field>
        <Field label="Your name (what the group calls you)">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Priya"
            maxLength={40}
            required
            disabled={busy || retryLocked}
          />
        </Field>
        {error && <p className="text-sm font-bold text-red" role="alert">{error}</p>}
        {retryLocked && (
          <p className="text-sm text-dim">
            This request may already have reached the party. Keep these details
            unchanged and retry once to recover it safely.
          </p>
        )}
        <Button full disabled={busy || !eventName.trim() || !displayName.trim()}>
          {busy ? "Setting up…" : retryLocked ? "Check & retry" : "Create & get my code"}
        </Button>
      </form>
    </main>
  );
}
