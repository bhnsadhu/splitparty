import { ButtonLink, Wordmark } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Wordmark />
      <p className="mt-10 text-sm font-bold uppercase tracking-widest text-faint">
        Party not found
      </p>
      <h1 className="mt-2 font-display text-3xl font-black leading-tight text-ink">
        There&rsquo;s nothing at this link.
      </h1>
      <p className="mt-3 leading-relaxed text-dim">
        The party link may be incomplete. Go back and use the five-character code.
      </p>
      <ButtonLink href="/" full className="mt-8">
        Back to my parties
      </ButtonLink>
    </main>
  );
}
