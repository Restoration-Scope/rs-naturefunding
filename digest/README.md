# Weekly email (email.naturefunding.org)

At most one email a week to each subscriber, listing calls that opened, calls announced and programmes new to the site since their last email, filtered by the country and type of project they chose. Nothing new, no email.

It runs as its own Cloudflare Worker on its own hostname, so the site stays static assets with no Worker script. The sign-up form (`src/components/DigestSignup.astro`) is a plain form post with no JS; the Worker answers with redirects to the static pages under `src/pages/digest/`. Not deployed yet.

## How it works

- **Sign-up, double opt-in.** The form posts email, `where` and `approach` (the finder's own values) to `/subscribe`. The Worker seals them into a link token (AES-GCM, `src/token.ts`) and emails a confirmation link; nothing about the person is stored until they press **Confirm my email** on the page that link opens (a link scanner opening it subscribes no one). Confirming again with other choices replaces them.
- **Limits.** Per IP 5 posts a minute (rate-limit binding); per address 1 confirmation email an hour and 3 a day; 20 confirmation emails a day overall. Counted by a keyed hash of the address, kept 2 days. The form's answer is the same whether or not a limit applied.
- **What's new** comes from git: `scripts/history.ts` compares each commit on main that touched `data/programmes` with its parent (`src/events.ts`): a new programme, a call whose status became `open`, or one that became `upcoming` (a call that reopens is news again). The events of the last year and the programmes are inlined into the bundle at build time, like the MCP Worker, so the Worker redeploys with every data change.
- **The daily run** (cron, 08:00 UTC) picks subscribers whose last email is 7+ days old, builds each one's digest from changes after the last one it covered (`src/digest.ts`), drops calls that have since closed (deadline in the funder's time zone), and sends one email per subscriber, so one refused address doesn't hold back the rest. At most `DAILY_DIGEST_LIMIT` (75) a UTC day across all runs; with the 20 confirmation emails that stays inside Resend's free 100 a day and 3,000 a month, and a large list spreads over the week.
- **Never twice.** The day's sends are claimed in D1 before any goes to Resend, each with an idempotency key per subscriber and day, and a claim is undone only when Resend certainly sent nothing (a 4xx; a 429 stops the run and gives the rest back). A timeout or 5xx keeps the claim: that subscriber may miss one digest but never gets two. The next digest starts from the bundle's newest commit (`sent_through`), not the send time, so a change deployed after a send still goes out.
- **Unsubscribe.** Every digest carries `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058), so mail apps unsubscribe in one click; the link in the email opens a one-button page. Unsubscribing deletes the row.
- **Sending is off** (`DIGEST_SENDING: "off"`): the daily run only counts who would get an email. The first real send needs Bernat's OK; then set it to `"live"`.

## Run locally

```bash
bun digest/scripts/setup-resend.ts     # once: the Resend key into Keychain (hidden prompt)
bun digest/scripts/setup-local.ts      # writes digest/.dev.vars (names only printed)
cd digest && bun run db:local          # creates the local D1 tables
bun run dev                            # http://localhost:8790, with the site's dev server on :4332
curl "http://localhost:8790/cdn-cgi/handler/scheduled?cron=0+8+*+*+*"   # one daily run
bun test src
```

Locally every email goes to Resend's test inbox (`TEST_RECIPIENT=delivered@resend.dev`, sender `onboarding@resend.dev`): real API calls, nobody gets mail. In dev, the site's form posts to `http://localhost:8790/subscribe`.

## Sample digest

```bash
bun digest/scripts/preview.ts                              # this week, from the real history
bun digest/scripts/preview.ts --launch KE reforestation    # launch week: the seed counts as new
```

Writes `digest/preview/*.html` and `.txt`. To send the launch-week digest through the local Worker and Resend, build with `DIGEST_BASELINE=1 bun digest/scripts/build.ts` and set a test subscriber's `confirmed_at` before the seed.

## Deploy (not done; needs Bernat)

1. Resend: naturefunding.org has its own free Resend account, apart from Restoration Scope's, so the digest never uses up Restoration Scope's daily and monthly allowance. `bun digest/scripts/setup-resend.ts` stores its Full access key in Keychain, adds the domain with tracking off, and lists the DNS records; add them in Cloudflare, then create a sending-only key for the domain as the Worker's `RESEND_API_KEY`.
2. `bunx wrangler d1 create naturefunding-digest`, put its id in `wrangler.jsonc`, then apply `schema.sql` with `--remote`.
3. `wrangler secret put LIST_SECRET` (32 random bytes) and `RESEND_API_KEY`, through `/env-management`.
4. Deploy: the deploy workflow checks out with `fetch-depth: 0` (the events need history), runs `bun digest/scripts/build.ts`, then `bunx wrangler deploy --config digest/wrangler.jsonc`. The token needs D1 edit and Workers Routes edit on the zone.
5. After Bernat's OK for the first send: `DIGEST_SENDING` to `"live"`.

## Files

- `src/app.ts`: routes and the daily run, tested in `src/app.test.ts` against bun:sqlite with `schema.sql` and a recording mailer.
- `src/events.ts`, `scripts/history.ts`: what's new, from git.
- `src/digest.ts`, `src/match.ts`: one subscriber's digest; filters match the finder (`whereCodes` equals the site's).
- `src/email.ts`: the confirmation and digest emails (HTML and text).
- `src/consent.ts`: the consent words by version; the row keeps the version.
- `src/resend.ts`, `src/token.ts`: Resend's HTTP API and the link tokens.
