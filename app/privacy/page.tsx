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
        <Link href="/" className="inline-flex min-h-11 items-center text-sm font-bold text-dim">
          ← back
        </Link>
        <Wordmark />
      </header>

      <h1 className="font-display text-3xl font-black leading-tight text-ink">
        Privacy
      </h1>
      <p className="mt-2 text-sm text-faint">Last updated August 4, 2026</p>

      <div className="mt-8 space-y-6 leading-relaxed text-dim">
        <Section title="What SplitParty stores">
          <p>
            SplitParty has no accounts, passwords, or advertising profiles. To run
            your shared ledger, the app stores:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              A random ID generated and stored on this device. SplitParty sends it
              with app requests so the service can find your memberships. It is not
              your phone number, email address, or advertising ID, and other party
              members cannot see it.
            </li>
            <li>The display name you type when you create or join a party.</li>
            <li>Party names and their join codes.</li>
            <li>
              The money activity you and your group log: what got bought, amounts,
              who paid, payment confirmations, and the timestamps and status needed
              to keep that history consistent.
            </li>
            <li>
              If a create, expense, or payment request is interrupted, its random
              request ID and frozen form details stay on this device until the app
              can safely confirm or retry that same request.
            </li>
          </ul>
        </Section>

        <Section title="Where it lives">
          <p>
            Party data is stored in a Supabase database so everyone in the same party
            sees one ledger. A small cache of your party list, safe-retry details,
            and your random device ID are also stored on this device. Vercel serves SplitParty&rsquo;s public
            web, invitation, and privacy pages. These providers may process ordinary
            technical request information to host and operate the service. The full
            ledger is returned only to approved members of the same party; limited
            payment-confirmation details may remain available when someone leaves so
            the group can close out. Device IDs are never returned to other members.
          </p>
        </Section>

        <Section title="What SplitParty doesn't do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>No analytics, no ads, no trackers.</li>
            <li>No tracking across other apps or websites.</li>
            <li>No selling data or sharing it for advertising.</li>
            <li>SplitParty uses Supabase and Vercel to host and operate the service.</li>
            <li>No contacts, location, camera, or photo access.</li>
          </ul>
        </Section>

        <Section title="Deleting your data">
          <p>
            The button below removes this device&rsquo;s SplitParty identity and its
            membership access. Where a ledger must keep an old expense or confirmed
            payment so the group&rsquo;s totals still add up, the entry is unlinked from
            your device and renamed &ldquo;Departed.&rdquo; Hosts who want to erase an
            entire party for everyone can use &ldquo;Delete this party&rdquo; in Crew
            before deleting their personal data.
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
        Wipes this device&rsquo;s identity and removes you from every party. If you
        host a party, first approve an active member who can take it over or use
        &ldquo;Delete this party&rdquo; in Crew. There&rsquo;s no undo.
      </p>
      {error && <p className="mt-3 text-sm font-bold text-red" role="alert">{error}</p>}
      <Button variant="danger" full className="mt-4" disabled={busy} onClick={wipe}>
        {busy
          ? "Deleting…"
          : armed
            ? "Sure? Remove my identity"
            : "Delete my data"}
      </Button>
    </div>
  );
}
