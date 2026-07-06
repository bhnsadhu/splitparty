"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, TextInput, Wordmark } from "@/components/ui";
import { createEvent } from "@/lib/client";

export default function NewEvent() {
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { eventId } = await createEvent(eventName, displayName);
      router.push(`/e?id=${eventId}&welcome=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something broke. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="text-sm font-bold text-dim">
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
          />
        </Field>
        <Field label="Your name (what the group calls you)">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Priya"
            maxLength={40}
            required
          />
        </Field>
        {error && <p className="text-sm font-bold text-red">{error}</p>}
        <Button full disabled={busy || !eventName.trim() || !displayName.trim()}>
          {busy ? "Setting up…" : "Create & get my code"}
        </Button>
      </form>
    </main>
  );
}
