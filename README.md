# SplitParty

**Split the damage.** SplitParty is a mobile-first ledger for group expenses:
log what everyone spent on a trip or a night out, and it computes exactly who
owes whom, splitting to the cent and compressing the payback into the fewest
practical transfers instead of a tangle of everyone-pays-everyone.

No accounts, no email, no password. A device identifier and a five-character
party code are the entire identity model.

## Status

- **Web:** live at [https://getsplitparty.vercel.app/](https://getsplitparty.vercel.app/)
- **iOS:** the native Capacitor build is **currently in Apple's App Store review
  process**. It is not approved or published yet.

This is a real product being shipped to a real store, not a tutorial clone. The
sections below describe decisions a reviewer can check by reading the code.

## What makes this technically interesting

### The settlement algorithm

`computeLedger` in [lib/settle.ts](lib/settle.ts) does the whole ledger in one
pass over integer cents, then compresses the debt graph.

- **Exact splits, no drift.** Each expense splits across the participant
  roster snapshotted at the time it was logged. Leftover pennies rotate to a
  subset chosen by a seed derived from the expense UUID, so nobody
  systematically eats the remainder. Shares always sum to the expense exactly,
  which means all nets sum to exactly zero. A $100.00 three-way split produces
  3334 / 3333 / 3333 cents, not three roundings that lose a penny.
- **Debt simplification, not pairwise IOUs.** `minTransfers` repeatedly matches
  the largest debtor against the largest creditor, producing at most
  `participants - 1` payments that zero every balance exactly. The doc comment
  is explicit that this is a greedy result and does not claim the globally
  minimum transaction count, because the exact version is NP-hard and the
  greedy bound is what actually ships.
- **Deterministic across devices.** Sorting is stable and UUID-tiebroken, so
  every client renders the identical settlement plan from the same data. The
  test suite asserts this by recomputing the ledger with members, expenses, and
  settlements all reversed and requiring byte-identical transfers.
- **Immutable history.** Members who leave or are removed keep their original
  shares, the expenses they paid, and their confirmed settlements. Membership
  changes never rewrite financial history, and departed members with a nonzero
  footprint stay visible on the ledger as ghosts.
- **Fuzzed.** [tests/settle.test.ts](tests/settle.test.ts) runs 5,000
  seeded random scenarios asserting three invariants every time: shares sum to
  total spend, nets sum to zero, and the emitted transfer plan actually settles
  every balance.

### The security model

The app is a static export talking straight to Supabase from the browser and
from inside the iOS binary, so the publishable key is public by definition.
The security boundary is therefore in Postgres, not in the client.

- **Zero direct table access.** Every table is revoked from `anon` and
  `authenticated`, plus RLS enabled as defense in depth. See
  [the lockdown migration](supabase/migrations/20260706160609_client_rpcs_and_rls_lockdown.sql).
- **All logic lives in `SECURITY DEFINER` RPCs** with `set search_path = public,
  pg_temp`. The client can call exactly ten `sp_*` functions and nothing else.
  Internal helpers like `sp_check_device` are explicitly revoked, so they are
  not reachable even though they exist in the same schema.
- **Authorization is re-derived server side on every call.** The client passes a
  device ID; the RPC looks up the member row itself. There is no client-supplied
  role, host flag, or member ID that the database trusts.
- **Verified, not assumed.** [scripts/e2e.mjs](scripts/e2e.mjs) asserts that a
  direct table read is denied and that internal helper RPCs are unreachable.
  Against the live project, the anon key returns **HTTP 401 with Postgres error
  42501** on `events`, `members`, `expenses`, `settlements`, and on
  `sp_check_device`. The same script checks that an unrelated device gets a
  `notMember` response for someone else's event and is rejected outright when it
  tries to write an expense into it.
- **Race-safe under concurrency.** Mutating RPCs lock the parent `events` row
  first, then lock member rows in UUID order and **reload them** before
  authorizing. That ordering is deliberate: it closes the stale-host window and
  prevents lock inversion between membership changes and money writes. See
  `sp_member_action` in
  [the latest migration](supabase/migrations/20260804180000_immutable_expense_participants_and_safe_cleanup.sql).

### Host-approval join flow

Joining a party does not grant access to it.

- `sp_join_event` inserts new members as `pending`, never `active`.
- A pending member's `sp_event_state` returns a restricted payload: no roster,
  no expenses, no balances. `sp_my_events` reports zeroed aggregates for them,
  so the waiting screen cannot leak the party's spend total.
- Only an `active` host can approve or deny, enforced in SQL rather than by
  hiding a button.
- The full state machine is `pending`, `active`, `denied`, `left`, `removed`,
  with a `rerequest` transition back to `pending`. Each transition is a
  conditional `UPDATE` whose row count is checked, so a double tap or a
  concurrent host action raises "already handled" instead of silently
  double-applying.

### Two-party payment confirmation

Recording a payment does not move money.

- A settlement is created `pending` by the payer and only counts once the
  **receiver** confirms it. `computeLedger` skips anything that is not
  `confirmed`.
- `sp_resolve_settlement` scopes confirm and reject to `to_member = me` and
  cancel to `from_member = me`, so neither party can resolve the other's side.
- Leaving or being removed deletes that member's pending claims but leaves
  every confirmed settlement intact.

### Production hardening

- **One codebase, two build targets.** `npm run build` emits a pure static
  export into `out/` for Capacitor. `npm run build:web` opts out of
  `output: "export"` for the Vercel deploy. The keepalive route is named
  `route.web.ts` and registered through `pageExtensions` only in the web build,
  which keeps it out of the static export entirely. Without that split the iOS
  build fails, because a dynamic route handler is illegal under `output:
  "export"` and a static one would bake its response at build time.
- **Safe area handling throughout.** `viewportFit: "cover"` plus
  `env(safe-area-inset-*)` on every screen chrome, header, bottom nav, toast,
  and bottom sheet, so nothing lands under the notch or the home indicator.
  Inputs are pinned to 16px because anything smaller triggers iOS auto-zoom.
- **Idempotent mutations.** Create, expense, and settlement RPCs take a client
  request ID. Uncertain requests and their frozen payloads persist in
  localStorage across reload and relaunch, so a response timeout retries with
  the same UUID instead of creating a duplicate row. A retry with a changed
  payload under an already-used request ID is rejected.
- **Guaranteed uptime on the free tier.** Supabase pauses free projects after 7
  idle days, and web traffic does not count; a query has to reach Postgres. A
  paused database previously broke an App Store review build, so two
  **independent** schedules keep it warm:

  | Trigger | Schedule (UTC) | Path |
  | --- | --- | --- |
  | Vercel cron ([vercel.json](vercel.json)) | Sun + Wed 12:00 | `/api/keepalive/` |
  | GitHub Actions ([keepalive.yml](.github/workflows/keepalive.yml)) | Mon + Thu 06:00 | Supabase REST directly |

  Four pings a week, longest gap about 3.25 days. The two paths share no
  infrastructure, so a failed build or a Vercel incident cannot disable both.
  Both call a read-only RPC with a synthetic device ID that matches no real
  member, and the workflow asserts the response body is `[]` so an edge error
  page can never be mistaken for a successful ping. The cron path keeps its
  trailing slash on purpose, since `trailingSlash: true` makes
  `/api/keepalive` a 308 and Vercel cron redirect-following is undocumented.

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Data | Supabase Postgres, accessed only through `SECURITY DEFINER` RPCs |
| iOS | Capacitor 8, native Xcode project in [ios/](ios/) |
| Web hosting | Vercel, plus Vercel Cron for the keepalive |
| CI | GitHub Actions |
| Tests | Node's built-in test runner, no test framework dependency |

There is no Next.js runtime server and no application API routes. Every screen
talks to Supabase directly. The single exception is `/api/keepalive`, which
exists only on the web deploy and serves no product feature.

Money is integer cents everywhere, from the Postgres column to the React state
to the formatter in [lib/money.ts](lib/money.ts). Floats never touch a balance.

## Getting started locally

Node.js 22.15 or newer is required, for the TypeScript-aware built-in test
runner and its ESM resolution hook.

```bash
git clone https://github.com/bhnsadhu/splitparty.git
cd splitparty
npm ci
cp .env.example .env.local
npm run dev
```

Point `.env.local` at your own Supabase project or an isolated development one.
Use only a Supabase **publishable** key. Never put a secret or service-role key
in a `NEXT_PUBLIC_*` variable.

To provision the schema, apply the migrations in
[supabase/migrations/](supabase/migrations/) in filename order.

### Checks

```bash
npm run lint
npm run typecheck
npm test        # 18 tests, including the 5,000-scenario ledger fuzz
npm run build   # static export into ./out
npm start       # preview the export at http://localhost:3000
```

`scripts/e2e.mjs` and `scripts/e2e2.mjs` run the full multi-device flow against
a configured Supabase backend: create, join, approve, expense, settle, confirm,
reject, cancel, leave. They create a temporary party and delete it afterward.

### iOS

```bash
npm run build
npm run ios:sync
open ios/App/App.xcodeproj
```

`cap sync` copies `out/` into the native project. The app ships as
`com.bhanusadhu.splitparty`.
