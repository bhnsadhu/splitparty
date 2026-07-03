"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CrewTab from "@/components/CrewTab";
import SettleTab from "@/components/SettleTab";
import SpendTab from "@/components/SpendTab";
import Ticket from "@/components/Ticket";
import { Button, Money, Sheet, Wordmark } from "@/components/ui";
import { api, useEventState } from "@/lib/client";
import type { EventState, RestrictedState } from "@/lib/types";

type Tab = "spend" | "settle" | "crew";

type RestrictedWithQueue = RestrictedState & {
  pendingConfirmations: { id: string; fromName: string; amountCents: number }[];
};

export default function EventScreen({
  eventId,
  welcome,
}: {
  eventId: string;
  welcome: boolean;
}) {
  const { state, error, refetch } = useEventState(eventId);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  if (error && (error.status === 404 || error.status === 403)) {
    return (
      <CenteredNote title="You're not in this one.">
        <Link href="/join" className="block">
          <Button full>Join with a code</Button>
        </Link>
      </CenteredNote>
    );
  }

  if (!state) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center">
        <Wordmark />
      </main>
    );
  }

  return (
    <>
      {toast && (
        <div className="fade-in fixed left-1/2 top-[calc(1rem+env(safe-area-inset-top))] z-[60] w-[calc(100%-3rem)] max-w-sm -translate-x-1/2 rounded-xl border border-line bg-raised px-4 py-3 text-center text-sm font-bold text-ink shadow-lg">
          {toast}
        </div>
      )}
      {state.restricted ? (
        <RestrictedView
          state={state as RestrictedWithQueue}
          eventId={eventId}
          refetch={refetch}
          notify={notify}
        />
      ) : (
        <ActiveEvent
          state={state}
          welcome={welcome}
          refetch={refetch}
          notify={notify}
        />
      )}
    </>
  );
}

/* ---------------- Active member experience ---------------- */

function ActiveEvent({
  state,
  welcome,
  refetch,
  notify,
}: {
  state: EventState;
  welcome: boolean;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("spend");
  const [ticketOpen, setTicketOpen] = useState(false);

  useEffect(() => {
    if (welcome) setTicketOpen(true);
  }, [welcome]);

  return (
    <main className="mx-auto min-h-dvh max-w-md pb-32">
      <header className="sticky top-0 z-40 border-b border-line bg-void/90 px-5 pb-3 pt-[calc(0.9rem+env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="My parties" className="shrink-0 text-lg text-dim">
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold text-ink">
            {state.event.name}
          </h1>
          <button
            onClick={() => setTicketOpen(true)}
            className="shrink-0 rounded-full bg-lime px-3 py-1.5 font-display text-xs font-black tracking-[0.15em] text-void transition-transform active:scale-95"
          >
            {state.event.code}
          </button>
        </div>
      </header>

      <div className="px-5 pt-5">
        {tab === "spend" && (
          <SpendTab
            state={state}
            refetch={refetch}
            notify={notify}
            goSettle={() => setTab("settle")}
          />
        )}
        {tab === "settle" && (
          <SettleTab state={state} refetch={refetch} notify={notify} />
        )}
        {tab === "crew" && (
          <CrewTab
            state={state}
            refetch={refetch}
            notify={notify}
            openTicket={() => setTicketOpen(true)}
          />
        )}
      </div>

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-line bg-void/95 backdrop-blur">
        <div className="grid grid-cols-3 pb-[env(safe-area-inset-bottom)]">
          <TabButton label="Spend" active={tab === "spend"} onClick={() => setTab("spend")} />
          <TabButton
            label="Settle"
            active={tab === "settle"}
            badge={state.pendingForMe}
            onClick={() => setTab("settle")}
          />
          <TabButton label="Crew" active={tab === "crew"} onClick={() => setTab("crew")} />
        </div>
      </nav>

      <Sheet open={ticketOpen} onClose={() => setTicketOpen(false)}>
        <Ticket code={state.event.code} eventName={state.event.name} />
      </Sheet>
    </main>
  );
}

function TabButton({
  label,
  active,
  badge = 0,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="relative flex h-16 flex-col items-center justify-center"
    >
      <span
        className={`font-display text-sm font-bold ${active ? "text-lime" : "text-dim"}`}
      >
        {label}
        {badge > 0 && (
          <span className="pulse-dot absolute -right-4 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-pink px-1 text-xs font-black text-void">
            {badge}
          </span>
        )}
      </span>
      <span
        className={`mt-1 h-1 w-8 rounded-full transition-colors ${active ? "bg-lime" : "bg-transparent"}`}
      />
    </button>
  );
}

/* ---------------- Outside the room ---------------- */

function RestrictedView({
  state,
  eventId,
  refetch,
  notify,
}: {
  state: RestrictedWithQueue;
  eventId: string;
  refetch: () => Promise<void>;
  notify: (msg: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function memberAction(action: "leave" | "rerequest") {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/members/${state.me.memberId}`, { action });
      if (action === "leave") {
        notify("Request cancelled.");
        router.push("/");
      } else {
        await refetch();
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something broke.");
      setBusy(false);
    }
  }

  async function resolve(sid: string, action: "confirm" | "reject") {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/settlements/${sid}`, { action });
      await refetch();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something broke.");
    } finally {
      setBusy(false);
    }
  }

  const copy: Record<string, { title: string; body: string }> = {
    pending: {
      title: "You're at the door.",
      body: `Hang tight — ${state.hostName} has to let you in. This screen updates itself, no refreshing needed.`,
    },
    left: {
      title: "You left this party.",
      body: "Your confirmed history is safe. Ask to join again and the host can let you back in.",
    },
    removed: {
      title: "The host removed you from this one.",
      body: "Anything already settled stays settled. You can ask to join again.",
    },
    denied: {
      title: "The host didn't let you in.",
      body: "Wrong party? Typo'd name? You can knock again.",
    },
  };
  const c = copy[state.me.status] ?? copy.pending;

  return (
    <CenteredNote eyebrow={state.event.name} title={c.title} body={c.body}>
      {state.pendingConfirmations.length > 0 && (
        <div className="mb-6 space-y-3 text-left">
          <p className="text-sm font-bold uppercase tracking-widest text-faint">
            Still waiting on you
          </p>
          {state.pendingConfirmations.map((p) => (
            <div key={p.id} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-ink">
                <span className="font-bold">{p.fromName}</span> says they paid you{" "}
                <Money cents={p.amountCents} className="font-bold text-lime" />
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button small disabled={busy} onClick={() => resolve(p.id, "confirm")}>
                  Yep, got it
                </Button>
                <Button
                  small
                  variant="ghost"
                  disabled={busy}
                  onClick={() => resolve(p.id, "reject")}
                >
                  No they didn&rsquo;t
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {state.me.status === "pending" ? (
        <Button variant="ghost" full disabled={busy} onClick={() => memberAction("leave")}>
          Cancel my request
        </Button>
      ) : (
        <Button full disabled={busy} onClick={() => memberAction("rerequest")}>
          Ask to join again
        </Button>
      )}
      <Link href="/" className="mt-3 block">
        <Button variant="ghost" full>
          Back to my parties
        </Button>
      </Link>
    </CenteredNote>
  );
}

function CenteredNote({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-10">
        <Wordmark />
      </div>
      {eyebrow && (
        <p className="mb-2 text-sm font-bold uppercase tracking-widest text-faint">
          {eyebrow}
        </p>
      )}
      <h1 className="font-display text-3xl font-black leading-tight text-ink">{title}</h1>
      {body && <p className="mt-3 leading-relaxed text-dim">{body}</p>}
      <div className="mt-8">{children}</div>
    </main>
  );
}
