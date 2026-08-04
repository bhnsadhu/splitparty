"use client";

import { Button, ButtonLink, Wordmark } from "@/components/ui";

export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Wordmark />
      <h1 className="mt-10 font-display text-3xl font-black leading-tight text-ink">
        Something went wrong.
      </h1>
      <p className="mt-3 leading-relaxed text-dim">
        Try this screen again, or head back to your parties.
      </p>
      <Button full className="mt-8" onClick={unstable_retry}>
        Try again
      </Button>
      <ButtonLink href="/" variant="ghost" full className="mt-3">
        Back to my parties
      </ButtonLink>
    </main>
  );
}
