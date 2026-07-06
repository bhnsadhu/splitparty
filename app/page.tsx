"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, Money, Wordmark } from "@/components/ui";
import { HOME_CACHE_KEY, myEvents } from "@/lib/client";
import type { MyEventSummary } from "@/lib/types";

export default function Home() {
  const [events, setEvents] = useState<MyEventSummary[] | null>(null);

  useEffect(() => {
    // Paint instantly from the last known list, then refresh from the server.
    try {
      const cached = localStorage.getItem(HOME_CACHE_KEY);
      if (cached) setEvents(JSON.parse(cached));
    } catch {}
    myEvents()
      .then((events) => {
        setEvents(events);
        localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(events));
      })
      .catch(() => setEvents((prev) => prev ?? []));
  }, []);

  if (events === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center">
        <Wordmark />
      </main>
    );
  }

  if (events.length === 0) return <FirstOpen />;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <header className="mb-8 flex items-center justify-between">
        <Wordmark />
        <span className="text-sm text-faint">split the damage</span>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3">
        <Link href="/new">
          <Button full>Start a party</Button>
        </Link>
        <Link href="/join">
          <Button variant="ghost" full>
            I have a code
          </Button>
        </Link>
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-faint">
        Your parties
      </h2>
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e.eventId}>
            <Link
              href={`/e?id=${e.eventId}`}
              className="block rounded-2xl border border-line bg-surface p-4 transition-transform active:scale-[0.98]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-display text-lg font-bold leading-snug text-ink">
                  {e.eventName}
                </span>
                {e.pendingForMe > 0 && (
                  <Chip tone="red" className="pulse-dot shrink-0">
                    {e.pendingForMe} to confirm
                  </Chip>
                )}
                {e.myStatus === "pending" && (
                  <Chip tone="dim" className="shrink-0">
                    waiting to get in
                  </Chip>
                )}
              </div>
              <p className="mt-1 text-sm text-dim">
                you&rsquo;re {e.myName}
                {e.isHost && " · host"}
                {e.myStatus === "active" && ` · ${e.activeCount} in`}
              </p>
              {e.myStatus === "active" && (
                <p className="mt-2 text-sm text-faint">
                  The damage:{" "}
                  <Money cents={e.totalSpentCents} className="font-bold text-ink" />
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <footer className="mt-10 text-center">
        <Link href="/privacy" className="text-xs text-faint underline">
          Privacy & my data
        </Link>
      </footer>
    </main>
  );
}

function FirstOpen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))]">
      <div>
        <Wordmark big />
        <p className="mt-6 font-display text-xl font-bold text-ink">
          Split the damage.
        </p>
        <p className="mt-4 max-w-[34ch] text-base leading-relaxed text-dim">
          Six people bought stuff for the party. Nobody remembers who owes what.
          Log it here. We do the math and square everyone up in the fewest
          payments possible.
        </p>
      </div>

      <div className="space-y-3">
        <Link href="/new" className="block">
          <Button full>Start a party</Button>
        </Link>
        <Link href="/join" className="block">
          <Button variant="ghost" full>
            I have a code
          </Button>
        </Link>
        <p className="pt-2 text-center text-xs text-faint">
          no accounts · no sign-ups · just a code
        </p>
        <p className="text-center">
          <Link href="/privacy" className="text-xs text-faint underline">
            Privacy & my data
          </Link>
        </p>
      </div>
    </main>
  );
}
