"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import EventScreen from "@/components/EventScreen";
import { Button } from "@/components/ui";

// Query param instead of a dynamic segment so the whole app can ship as
// static files (Capacitor has no server to resolve /e/<id> routes).
export default function EventPage() {
  return (
    <Suspense>
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
        <Link href="/" className="block w-full">
          <Button full>Back to my parties</Button>
        </Link>
      </main>
    );
  }
  return <EventScreen eventId={id} welcome={welcome} />;
}
