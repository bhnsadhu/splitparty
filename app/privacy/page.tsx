"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Wordmark } from "@/components/ui";
import { deleteMyData } from "@/lib/client";

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="text-sm font-bold text-dim">
          ← back
        </Link>
        <Wordmark />
      </header>

      <h1 className="font-display text-3xl font-black leading-tight text-ink">
        Privacy
      </h1>
      <p className="mt-2 text-sm text-faint">Last updated July 6, 2026</p>

      <div className="mt-8 space-y-6 leading-relaxed text-dim">
        <Section title="What SplitParty stores">
          <p>
            SplitParty has no accounts, no passwords, and no profiles. When you use
            the app it stores exactly this, and nothing else:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              A random device ID generated on your phone. It identifies this device
              inside your parties. It is not your name, phone number, email, or
              advertising ID, and it can&rsquo;t be traced back to you.
            </li>
            <li>The display name you type when you create or join a party.</li>
            <li>Party names and their join codes.</li>
            <li>
              The money activity you and your group log: what got bought, amounts,
              who paid, and payment confirmations.
            </li>
          </ul>
        </Section>

        <Section title="Where it lives">
          <p>
            That data is stored in a Supabase database so everyone in your party
            sees the same ledger. It is visible only to members of the same party.
            Your device ID never leaves the database, other members can&rsquo;t see
            it.
          </p>
        </Section>

        <Section title="What SplitParty doesn't do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>No analytics, no ads, no trackers.</li>
            <li>No tracking across other apps or websites.</li>
            <li>No selling or sharing data with anyone.</li>
            <li>No contacts, location, camera, or photo access.</li>
          </ul>
        </Section>

        <Section title="Deleting your data">
          <p>
            The button below erases you from SplitParty: your device identity, your
            memberships in every party, and any parties you host that no one else
            has money history in. Where your name appears in another group&rsquo;s
            confirmed ledger, the entry stays but is renamed
            &ldquo;Departed&rdquo; and unlinked from your device, so their math
            still adds up without pointing at you.
          </p>
        </Section>

        <Section title="Questions">
          <p>Email sadhubhanu07@gmail.com.</p>
        </Section>
      </div>

      <DeleteMyData />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-faint">
        {title}
      </h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}

function DeleteMyData() {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function wipe() {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteMyData();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-faint">
        Delete my data
      </h2>
      <p className="mt-2 text-sm text-dim">
        Wipes this device&rsquo;s identity and removes you from every party.
        There&rsquo;s no undo.
      </p>
      {error && <p className="mt-3 text-sm font-bold text-red">{error}</p>}
      <Button variant="danger" full className="mt-4" disabled={busy} onClick={wipe}>
        {busy
          ? "Deleting…"
          : armed
            ? "Sure? This erases everything"
            : "Delete my data"}
      </Button>
    </div>
  );
}
