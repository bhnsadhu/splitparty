"use client";

import { useEffect } from "react";
import { formatMoney } from "@/lib/money";

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "ghost" | "danger" | "quiet";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-blue text-void font-bold hover:brightness-105 active:brightness-95 disabled:opacity-40",
  ghost:
    "border border-line bg-transparent text-ink font-bold hover:bg-surface active:bg-raised disabled:opacity-40",
  danger:
    "border border-danger/40 bg-transparent text-danger font-bold hover:bg-danger/10 disabled:opacity-40",
  quiet: "bg-raised text-ink font-bold hover:bg-line/60 disabled:opacity-40",
};

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
      className={[
        "rounded-2xl transition-transform active:scale-[0.97] disabled:active:scale-100",
        small ? "h-10 px-4 text-sm" : "h-14 px-6 text-base",
        full ? "w-full" : "",
        buttonStyles[variant],
        className,
      ].join(" ")}
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

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-14 w-full rounded-xl border border-line bg-surface px-4 text-ink",
        "placeholder:text-faint focus:border-blue focus:outline-none",
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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        aria-label="Close"
        className="fade-in absolute inset-0 w-full bg-black/60"
        onClick={onClose}
      />
      <div className="sheet-in absolute bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 rounded-t-3xl border-t border-line bg-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {title && (
          <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
        )}
        {children}
      </div>
    </div>
  );
}

/* ---------- Avatar ---------- */

const AVATAR_COLORS = ["#3c83f5", "#7dd3fc", "#a5b4fc", "#dde2ee", "#f7a8be", "#93c5fd"];

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
      style={{ background: bg, color: "#19191d", opacity: dim ? 0.45 : 1 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ---------- Chip ---------- */

type ChipTone = "blue" | "sky" | "rose" | "dim";
const chipTones: Record<ChipTone, string> = {
  blue: "bg-blue text-void",
  sky: "bg-sky/15 text-sky",
  rose: "bg-rose/15 text-rose",
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
        <span className="block text-6xl text-blue">PARTY</span>
      </h1>
    );
  }
  return (
    <span className="font-display text-base font-black tracking-tight">
      <span className="text-ink">SPLIT</span>
      <span className="text-blue">PARTY</span>
    </span>
  );
}
