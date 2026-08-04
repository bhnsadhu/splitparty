"use client";

import { Button, Wordmark } from "@/components/ui";
import "./globals.css";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html
      lang="en"
      style={
        {
          "--font-unbounded": '"Arial Black", Arial, sans-serif',
          "--font-grotesk": "system-ui, sans-serif",
        } as React.CSSProperties
      }
    >
      <body className="min-h-dvh bg-void text-ink">
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
          <Wordmark />
          <h1 className="mt-10 font-display text-3xl font-black leading-tight text-ink">
            SplitParty hit a snag.
          </h1>
          <p className="mt-3 leading-relaxed text-dim">
            Try loading this screen again. If that does not work, close and reopen the app.
          </p>
          <Button full className="mt-8" onClick={unstable_retry}>
            Try again
          </Button>
        </main>
      </body>
    </html>
  );
}
