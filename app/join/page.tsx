"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Field, TextInput, Wordmark } from "@/components/ui";
import { joinEvent } from "@/lib/client";

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code")?.toUpperCase() ?? "");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { eventId } = await joinEvent(code, displayName);
      router.push(`/e?id=${eventId}`);
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
        Got a code?
      </h1>
      <p className="mt-2 text-dim">
        Type it in. The host lets you through the door, then you can see and log
        spending.
      </p>

      <form onSubmit={join} className="mt-8 space-y-5">
        <Field label="Party code">
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K7XF4"
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="text-center font-display text-2xl font-bold tracking-[0.35em]"
            autoFocus={!code}
            required
          />
        </Field>
        <Field label="Your name (what the group calls you)">
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex"
            maxLength={40}
            autoFocus={!!code}
            required
          />
        </Field>
        {error && <p className="text-sm font-bold text-red">{error}</p>}
        <Button full disabled={busy || code.trim().length < 4 || !displayName.trim()}>
          {busy ? "Knocking…" : "Ask to join"}
        </Button>
      </form>
    </main>
  );
}
