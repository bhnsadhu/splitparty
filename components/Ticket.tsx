"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * The signature moment: a blue ticket stub with the join code.
 * Built to be screenshotted and dropped into a group chat.
 */
export default function Ticket({
  code,
  eventName,
}: {
  code: string;
  eventName: string;
}) {
  const [copied, setCopied] = useState(false);

  const link = () => `${window.location.origin}/join?code=${code}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  async function share() {
    const url = link();
    if (navigator.share) {
      try {
        await navigator.share({
          title: "SplitParty",
          text: `Join "${eventName}" on SplitParty, code ${code}`,
          url,
        });
        return;
      } catch {}
    }
    copyLink();
  }

  return (
    <div>
      <div className="relative -rotate-1 rounded-2xl bg-blue p-5 text-ink">
        {/* punch holes */}
        <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-raised" />
        <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-raised" />

        <p className="text-xs font-bold uppercase tracking-widest">
          admit your whole group chat
        </p>
        <p className="mt-1 truncate font-display text-lg font-bold">{eventName}</p>
        <div className="my-4 border-t-2 border-dashed border-ink/30" />
        <p className="text-center font-display text-5xl font-black tracking-[0.18em]">
          {code}
        </p>
        <p className="mt-3 text-center text-xs font-bold uppercase tracking-widest">
          splitparty · say it out loud or send the link
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="quiet" onClick={copyLink}>
          {copied ? "Copied ✓" : "Copy link"}
        </Button>
        <Button onClick={share}>Share it</Button>
      </div>
    </div>
  );
}
