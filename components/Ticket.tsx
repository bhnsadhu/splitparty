"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";
import { Share } from "@capacitor/share";
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
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(
    null,
  );

  // Always the public web URL: inside Capacitor the origin is
  // capacitor://localhost, which would be a dead link for anyone you send it to.
  const link = () =>
    `${process.env.NEXT_PUBLIC_APP_URL ?? "https://splitparty-bhanu-sadhu-s-projects.vercel.app"}/join/?code=${code}`;

  function showFeedback(message: string, error = false) {
    setFeedback({ message, error });
    window.setTimeout(() => setFeedback(null), 2600);
  }

  // Plain text, always. On iOS, navigator.clipboard.writeText does not put a bare
  // string on the pasteboard: WebKit also stamps com.apple.WebKit.custom-pasteboard-data
  // (a binary plist) and, because the string parses as a URL, public.url. Apps that
  // read the first type they find paste "bplist00..." instead of the link. The native
  // clipboard writes UIPasteboard.general.string -- one item, public.utf8-plain-text.
  async function writeLink(): Promise<boolean> {
    try {
      const url = link();
      if (Capacitor.isNativePlatform()) {
        await Clipboard.write({ string: url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      return true;
    } catch {
      setCopied(false);
      showFeedback("Couldn't copy the link. You can still share the five-character code.", true);
      return false;
    }
  }

  async function copyLink() {
    if (busy) return;
    setBusy(true);
    const didCopy = await writeLink();
    if (didCopy) showFeedback("Link copied.");
    setBusy(false);
  }

  // Same rule as the clipboard: share one plain string. Handing the share sheet a
  // separate `url` makes it an NSURL activity item, so "Copy" from the sheet puts a
  // URL object on the pasteboard and plain text fields show binary instead of a link.
  async function share() {
    if (busy) return;
    setBusy(true);
    const message = `Join "${eventName}" on SplitParty, code ${code}\n${link()}`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: "SplitParty", text: message });
        showFeedback("Share sheet opened.");
        setBusy(false);
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "SplitParty", text: message });
        showFeedback("Share sheet opened.");
        setBusy(false);
        return;
      }
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && /cancell?ed/i.test(error.message));
      if (aborted) {
        setBusy(false);
        return;
      }
    }
    const didCopy = await writeLink();
    if (didCopy) showFeedback("Sharing wasn't available, so the link was copied instead.");
    setBusy(false);
  }

  return (
    <div>
      <div className="relative -rotate-1 rounded-2xl bg-ink p-5 text-void">
        {/* punch holes */}
        <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-raised" />
        <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-raised" />

        <p className="text-xs font-bold uppercase tracking-widest">
          admit your whole group chat
        </p>
        <p className="mt-1 truncate font-display text-lg font-bold">{eventName}</p>
        <div className="my-4 border-t-2 border-dashed border-void/30" />
        <p className="text-center font-display text-5xl font-black tracking-[0.18em]">
          {code}
        </p>
        <p className="mt-3 text-center text-xs font-bold uppercase tracking-widest">
          splitparty · say it out loud or send the link
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="quiet" disabled={busy} onClick={copyLink}>
          {copied ? "Copied ✓" : "Copy link"}
        </Button>
        <Button disabled={busy} onClick={share}>Share it</Button>
      </div>
      {feedback && (
        <p
          className={`mt-3 text-center text-xs font-bold ${feedback.error ? "text-red" : "text-dim"}`}
          role={feedback.error ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
