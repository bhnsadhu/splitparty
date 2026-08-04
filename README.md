# SplitParty

**Split the damage.** SplitParty is a mobile-first group-expense ledger for
events. There are no accounts: a random device identifier stored on the device
represents the participant, and a five-character party code is the only way in.
The host approves new members before they can see the ledger.

## Product flow

- Start a party and share its code or canonical `/join/?code=XXXXX` link.
- Friends join and wait at the door until the host approves them.
- Active members log expenses, which are split evenly to the cent.
- SplitParty computes a deterministic repayment plan.
- A recorded payment remains pending until its receiver confirms or rejects it.

## Architecture

- Next.js App Router and Tailwind CSS, exported as static files into `out/`.
- Capacitor copies `out/` into the native iOS project and serves it on-device.
- The browser client calls narrowly scoped Supabase Postgres RPCs directly.
- The Supabase **publishable** key is expected to ship in the client. Table RLS,
  RPC grants, and server-side authorization remain the security boundary.
- Anonymous identity is a localStorage device UUID passed to every RPC.
- Event state refreshes every three seconds while the app is visible.
- Money is always represented as integer cents.

The app itself has no Next.js runtime server and no application API routes: every
screen talks to Supabase directly. The single exception is `/api/keepalive`,
which exists only on the Vercel web deploy and serves no product feature. See
[Supabase keepalive](#supabase-keepalive).

## Supabase keepalive

Supabase pauses free-tier projects after 7 days without real database activity.
Web traffic does not count; a query has to reach Postgres. A paused database
previously broke an App Store review build, so two independent schedules keep it
warm:

| Trigger | Schedule (UTC) | Path |
| --- | --- | --- |
| Vercel cron (`vercel.json`) | Sun + Wed 12:00 | `/api/keepalive/` |
| GitHub Actions (`.github/workflows/keepalive.yml`) | Mon + Thu 06:00 | Supabase REST directly |

Four pings a week, longest gap ~3.25 days. The two paths share no
infrastructure, so a broken deploy or a Vercel incident cannot disable both. Both
call `sp_my_events` with a synthetic device ID that matches no real member, so
the query is read-only and touches no real data.

Two details are load-bearing:

- The cron path keeps its **trailing slash**. `trailingSlash: true` makes
  `/api/keepalive` a 308 redirect, and Vercel cron following redirects is not
  documented.
- The route file is `route.web.ts`, not `route.ts`. `pageExtensions` in
  `next.config.ts` only registers `*.web.ts` for the web build, which keeps the
  route out of the static export. A dynamic route handler is illegal under
  `output: "export"`, and a static one would bake its response at build time and
  never reach Postgres.

## Ledger guarantees

- Expense shares sum exactly to the expense; leftover pennies rotate
  deterministically by expense ID.
- Only confirmed settlements change balances.
- Event, expense, and payment retries reuse client request IDs. Uncertain
  requests and their frozen payloads persist on-device across reload/relaunch,
  so a response timeout does not create duplicate rows after the release
  migration is applied.
- Departed members keep paid expenses and confirmed history, take no new share,
  and lose pending claims.
- Deterministic sorting gives every client the same settlement plan.

## Local setup

Node.js 22.15 or newer is required for the TypeScript-aware built-in test runner
and its ESM resolution hook.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the production or isolated development project as
appropriate. Only use a Supabase publishable key. Never place a secret or
service-role key in any `NEXT_PUBLIC_*` variable.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` runs TypeScript tests matching `tests/*.test.ts` with Node's built-in
test runner. After a build, `npm start` previews the static export at
`http://localhost:3000` using Python 3's standard-library HTTP server.

`npm run build` is the static export used by Capacitor and is what the iOS flow
below expects. `npm run build:web` sets `SP_WEB_BUILD=1` to build the Vercel
deploy instead, which drops `output: "export"` and adds the `/api/keepalive`
function; `vercel.json` pins it as the project's build command. To exercise the
route locally:

```bash
npm run build:web
SP_WEB_BUILD=1 npx next start -p 3100
curl http://localhost:3100/api/keepalive/
```

The two scripts in `scripts/e2e*.mjs` exercise live Supabase RPCs and require
explicit `SUPABASE_URL` and `SUPABASE_KEY` values. Local Supabase hosts run
directly; any remote host also requires `SPLITPARTY_E2E_ALLOW_REMOTE=1`, and the
known production project requires the stronger
`SPLITPARTY_E2E_ALLOW_PRODUCTION=I_UNDERSTAND_THIS_MUTATES_PRODUCTION`
acknowledgement. The scripts create real rows and perform best-effort cleanup in
both their success and caught-error paths, but a force-killed process can still
leave records behind.

## iOS release flow

```bash
npm run build
npm run ios:sync
xcodebuild -project ios/App/App.xcodeproj \
  -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

`out/`, `ios/App/App/public/`, and generated Capacitor configuration are ignored.
Always build before syncing, and always sync before compiling or archiving iOS.
The native marketing version and build number live in the Xcode project.

For the `20260804180000` release migration:

1. Verify the linked migration history first. Production and the local
   directory should both contain `20260703033851`, `20260706160609`, and
   `20260706161708`, with only `20260804180000` pending. Confirm that shape with
   `supabase migration list --linked` and `supabase db push --dry-run` before
   applying anything.
2. Audit every event with no active real member. The release migration aborts
   instead of inventing an owner or writing an empty financial snapshot:

   ```sql
   select e.id, e.code
   from public.events e
   where not exists (
     select 1 from public.members m
     where m.event_id = e.id and m.status = 'active'
       and m.device_id not like '%:guest:%'
   );
   ```

3. Quiesce client traffic and apply only the new migration as one transaction.
   Its initial `ACCESS EXCLUSIVE ... NOWAIT` lock intentionally aborts with
   `55P03` if a poll is still in flight; retry only after traffic is quiet.
4. Deploy the web export immediately after the migration, then ship the new iOS
   binary. The old RPC signatures remain callable during cutover, but old web or
   native code ignores immutable `participantIds` and is not ledger-compatible
   after membership changes. Confirm no old public native build is in use and
   retire cached/test builds.

Party invitation links use `NEXT_PUBLIC_APP_URL`. Before a release, deploy the
same web build to that HTTPS origin and verify `/`, `/new/`, `/join/?code=XXXXX`,
and `/privacy/` directly. App Store archives, signing, provisioning, TestFlight,
and the public privacy URL still require human verification in Apple and Vercel.
