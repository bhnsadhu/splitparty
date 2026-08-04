"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink, Chip, Money, Wordmark } from "@/components/ui";
import { HOME_CACHE_KEY, myEvents } from "@/lib/client";
import type { MyEventSummary } from "@/lib/types";

type LoadPhase = "loading" | "ready" | "error";
const MEMBER_STATUSES = new Set(["pending", "active", "left", "removed", "denied"]);
const isNonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isEventSummary(value: unknown): value is MyEventSummary {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.eventId === "string" &&
    typeof event.eventName === "string" &&
    typeof event.myName === "string" &&
    typeof event.myStatus === "string" &&
    MEMBER_STATUSES.has(event.myStatus) &&
    typeof event.isHost === "boolean" &&
    isNonnegativeInteger(event.activeCount) &&
    isNonnegativeInteger(event.totalSpentCents) &&
    isNonnegativeInteger(event.pendingForMe)
  );
}

export default function Home() {
  const [events, setEvents] = useState<MyEventSummary[] | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const mounted = useRef(true);

  const loadEvents = useCallback(async (readCache = false) => {
    if (readCache) {
      try {
        const cached = localStorage.getItem(HOME_CACHE_KEY);
        const parsed = cached ? (JSON.parse(cached) as unknown) : null;
        if (Array.isArray(parsed) && parsed.every(isEventSummary)) {
          if (mounted.current) setEvents(parsed);
        } else if (cached) {
          localStorage.removeItem(HOME_CACHE_KEY);
        }
      } catch {
        // A corrupt or unavailable cache should never block a fresh request.
      }
    }

    if (mounted.current) setPhase("loading");
    try {
      const fresh = await myEvents();
      if (!mounted.current) return;
      setEvents(fresh);
      setPhase("ready");
      try {
        localStorage.setItem(HOME_CACHE_KEY, JSON.stringify(fresh));
      } catch {
        // The live result is still valid when local storage is unavailable.
      }
    } catch {
      if (mounted.current) setPhase("error");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Defer the client-only cache read until after hydration.
    const timer = window.setTimeout(() => void loadEvents(true), 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, [loadEvents]);

  if (events === null && phase === "error") {
    return <HomeLoadError retry={() => void loadEvents()} />;
  }

  if (events === null || (events.length === 0 && phase === "loading")) {
    return (
      <main
        className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6"
        aria-busy="true"
      >
        <Wordmark />
        <p className="text-sm text-dim">Loading your parties…</p>
      </main>
    );
  }

  if (events.length === 0 && phase === "error") {
    return <HomeLoadError retry={() => void loadEvents()} />;
  }

  if (events.length === 0) return <FirstOpen />;

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <header className="mb-8 flex items-center justify-between">
        <Wordmark />
        <span className="text-sm text-faint">split the damage</span>
      </header>

      {phase !== "ready" && (
        <HomeStatusBanner
          refreshing={phase === "loading"}
          retry={() => void loadEvents()}
        />
      )}

      <div className="mb-8 grid grid-cols-2 gap-3">
        <ButtonLink href="/new" full>Start a party</ButtonLink>
        <ButtonLink href="/join" variant="ghost" full>I have a code</ButtonLink>
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
        <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 text-xs text-faint underline">
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
          Log it here. We do the math and give everyone a clear way to square up.
        </p>
      </div>

      <div className="space-y-3">
        <ButtonLink href="/new" full>Start a party</ButtonLink>
        <ButtonLink href="/join" variant="ghost" full>I have a code</ButtonLink>
        <p className="pt-2 text-center text-xs text-faint">
          no accounts · no sign-ups · just a code
        </p>
        <p className="text-center">
          <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 text-xs text-faint underline">
            Privacy & my data
          </Link>
        </p>
      </div>
    </main>
  );
}

function HomeStatusBanner({
  refreshing,
  retry,
}: {
  refreshing: boolean;
  retry: () => void;
}) {
  return (
    <div
      className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
        refreshing ? "border-line bg-surface text-dim" : "border-red/40 bg-red/10 text-ink"
      }`}
      role={refreshing ? "status" : "alert"}
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1">
          {refreshing
            ? "Checking for the latest party activity…"
            : "Couldn't refresh. Showing the last saved party list."}
        </p>
        {!refreshing && (
          <Button small variant="quiet" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

function HomeLoadError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Wordmark />
      <h1 className="mt-10 font-display text-3xl font-black leading-tight text-ink">
        We couldn&rsquo;t load your parties.
      </h1>
      <p className="mt-3 leading-relaxed text-dim">
        Check your connection and try again. Your party data hasn&rsquo;t been changed.
      </p>
      <Button full className="mt-8" onClick={retry}>
        Try again
      </Button>
      <ButtonLink href="/privacy" variant="ghost" full className="mt-3">
        Privacy &amp; my data
      </ButtonLink>
    </main>
  );
}
