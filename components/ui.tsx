"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatMoney } from "@/lib/money";

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "ghost" | "danger" | "quiet";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-void font-bold hover:brightness-95 active:brightness-90 disabled:opacity-40",
  ghost:
    "border border-line bg-transparent text-ink font-bold hover:bg-surface active:bg-raised disabled:opacity-40",
  danger:
    "border border-red/40 bg-transparent text-red font-bold hover:bg-red/10 disabled:opacity-40",
  quiet: "bg-surface text-ink font-bold hover:bg-line/60 disabled:opacity-40",
};

function buttonClassName({
  variant,
  small,
  full,
  className,
}: {
  variant: ButtonVariant;
  small: boolean;
  full: boolean;
  className: string;
}) {
  return [
    "inline-flex items-center justify-center rounded-2xl text-center transition-transform active:scale-[0.97] disabled:active:scale-100",
    small ? "h-11 px-4 text-sm" : "h-14 px-6 text-base",
    full ? "w-full" : "",
    buttonStyles[variant],
    className,
  ].join(" ");
}

export function Button({
  variant = "primary",
  small = false,
  full = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  small?: boolean;
  full?: boolean;
}) {
  return (
    <button
      {...props}
      className={buttonClassName({ variant, small, full, className })}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  small = false,
  full = false,
  className = "",
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  small?: boolean;
  full?: boolean;
}) {
  return (
    <Link
      {...props}
      className={buttonClassName({ variant, small, full, className })}
    />
  );
}

/* ---------- Money ---------- */

export function Money({
  cents,
  className = "",
}: {
  cents: number;
  className?: string;
}) {
  return <span className={`tnum ${className}`}>{formatMoney(cents)}</span>;
}

/* ---------- Inputs ---------- */

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-dim">{label}</span>
      {children}
    </label>
  );
}

export function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-dim">{label}</legend>
      {children}
    </fieldset>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-14 w-full rounded-xl border border-line bg-surface px-4 text-ink",
        "placeholder:text-faint focus:border-ink focus:outline-none",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

/* ---------- Sheet (bottom modal) ---------- */

export function Sheet({
  open,
  onClose,
  title,
  preventClose = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  preventClose?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !preventClose) onClose();
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, preventClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Dialog"}
      aria-busy={preventClose || undefined}
    >
      <button
        aria-hidden="true"
        tabIndex={-1}
        className="fade-in absolute inset-0 w-full bg-black/60"
        disabled={preventClose}
        onClick={() => {
          if (!preventClose) onClose();
        }}
      />
      <div
        ref={panelRef}
        className="sheet-panel sheet-in absolute bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 rounded-t-3xl border-t border-line bg-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close dialog"
          disabled={preventClose}
          onClick={onClose}
          className="absolute right-4 top-3 flex h-11 w-11 items-center justify-center rounded-full text-xl text-dim hover:bg-line/40 disabled:opacity-30"
        >
          ×
        </button>
        {title && (
          <h2 className="mb-4 pr-12 font-display text-lg font-bold text-ink">{title}</h2>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- Avatar ---------- */

// No green or red here: those always mean settled / outstanding, and an
// avatar must never read as a money state.
const AVATAR_COLORS = ["#F5F5F0", "#949490"];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, dim = false }: { name: string; dim?: boolean }) {
  const bg = AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
      style={{ background: bg, color: "#000000", opacity: dim ? 0.45 : 1 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ---------- Chip ---------- */

type ChipTone = "red" | "green" | "dim";
const chipTones: Record<ChipTone, string> = {
  red: "bg-red/15 text-red",
  green: "bg-green/15 text-green",
  dim: "bg-line/50 text-dim",
};

export function Chip({
  tone = "dim",
  children,
  className = "",
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${chipTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ---------- Time ---------- */

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- Wordmark ---------- */

export function Wordmark({ big = false }: { big?: boolean }) {
  if (big) {
    return (
      <h1 className="font-display font-black leading-[0.92] tracking-tight">
        <span className="block text-6xl text-ink">SPLIT</span>
        <span className="block text-6xl text-dim">PARTY</span>
      </h1>
    );
  }
  return (
    <span className="font-display text-base font-black tracking-tight">
      <span className="text-ink">SPLIT</span>
      <span className="text-dim">PARTY</span>
    </span>
  );
}
