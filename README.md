# SplitParty

**Split the damage.** Group-expense splitting for events — log who paid for what,
SplitParty nets it out and squares everyone up in the fewest payments possible.

No accounts. A 5-character party code is the only door. Host approves who gets in.

## How it works

- **Start a party** → you get a code + shareable link (`/join?code=XXXXX`).
- **Friends join** → they wait "at the door" until the host lets them in.
- **Anyone logs expenses** → split evenly across everyone currently in.
- **Settle up** → minimal-transfer plan (greedy debt simplification, ≤ n−1
  payments, exact to the cent). "Alex owes Priya $12.50."
- **Trust loop** → paying someone back creates a *pending* claim only the
  receiver can confirm. Confirmed → settled for everyone. Rejected → back to
  outstanding. Nothing settles silently.

## Stack

- Next.js (App Router) + Tailwind v4, dark-first, mobile-first
- Supabase Postgres (project `splitparty`), all money in integer cents
- All DB access via server API routes; the Supabase key never ships to browsers
- Identity = `localStorage` device id sent as `x-device-id` (no login)
- Live-ish updates via 3s visibility-aware polling

## Ledger rules (lib/settle.ts)

- Expense shares always sum **exactly** to the expense (leftover pennies rotate
  deterministically by expense id — nobody systematically eats the remainder).
- Only **confirmed** settlements move balances.
- Members who leave/are removed keep their paid expenses + confirmed history
  ("ghosts") but take no share; their pending claims are deleted.
- All clients see the identical plan (deterministic sort).

## Dev

```bash
npm install
npm run dev          # needs .env.local → SUPABASE_URL, SUPABASE_KEY
```

Tests (scratch scripts, run against a local server):
- settle-test.ts — 17 invariant checks incl. 200-scenario fuzz
- e2e.sh — 39-step full lifecycle (join/approve/expense/settle/confirm/leave)
