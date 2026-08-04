"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import EventScreen from "@/components/EventScreen";
import { ButtonLink, Wordmark } from "@/components/ui";

// Query param instead of a dynamic segment so the whole app can ship as
// static files (Capacitor has no server to resolve /e/<id> routes).
export default function EventPage() {
  return (
    <Suspense fallback={<EventRouteLoading />}>
      <EventFromQuery />
    </Suspense>
  );
}

function EventFromQuery() {
  const params = useSearchParams();
  const id = params.get("id");
  const welcome = params.get("welcome") === "1";

  if (!id) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6">
        <p className="text-dim">That link is missing its party.</p>
        <ButtonLink href="/" full>Back to my parties</ButtonLink>
      </main>
    );
  }
  return <EventScreen eventId={id} welcome={welcome} />;
}

function EventRouteLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6"
      aria-busy="true"
    >
      <Wordmark />
      <p className="text-sm text-dim">Opening the party…</p>
    </main>
  );
}
