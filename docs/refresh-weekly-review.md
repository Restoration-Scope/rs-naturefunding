# Weekly review of refresh PRs

The brief for the weekly scheduled task that checks the refresh PRs needing a person (part 4 of `decisions/2026-11-20-refresh-auto-commit-rule.md`). Run it from the main checkout of rs-naturefunding, on main, pulled. Follow `AGENTS.md`: first-party only, never infer a deadline, the "who we list" rules. Until 2027-02-14, don't change programme names, ids, site URLs or the sitemap.

## Each run

1. `gh pr list --label refresh --state open --limit 1000 --json number,title,url,body,createdAt`. Take the oldest 40.
2. For each one, read the body: the Changes table, the reviewer's verdict, its `Missed:` note, `Not confirmed`, and the `Needs a person:` line. Then read the funder page it names, live.
3. Decide, and never leave a PR as it was:
   - **Every applied row is right** (the value matches the page, and the quote is on it), and nothing missed or rejected contradicts the listing: sync it, then merge it.
   - **A row is wrong, or the page now states a fact that contradicts the listing** (a deadline, amount, eligibility or status): fix the PR branch. Drop the wrong row, or add the missing fact with its verbatim quote, `source_url` and today's `checked_at`. Run `bun run validate`, push, then sync and merge. Closing such a PR doesn't help: the next daily run drafts the same page again.
   - **`sync-pr.ts` exits 2** (a conflict beyond dates): close it with `gh pr close <n> --delete-branch --comment "Conflicts with main; the daily refresh re-drafts this page from main."`.
   - **The page is gone or no longer about the programme:** close it, and fix the programme's sources in a separate PR.
4. Sync and merge:
   ```bash
   bun scripts/refresh/sync-pr.ts <n> && gh pr merge <n> --squash --delete-branch
   ```
   `sync-pr.ts` merges main into the PR, takes the later date where only `checked_at` or `accepted_at` lines conflict, validates and pushes. It exits 2 on any other conflict.
5. Spot-check 5 changes the job committed itself this week: `git log --since=7.days --grep='checked dates' -p -- data/programmes`. Check the rows with a new value, not the date-only ones, against the live page.
6. Add one line to `docs/refresh-review-log.md`, then commit and push it to main:
   `- YYYY-MM-DD · merged N, fixed N, closed N, left N open · auto-commit spot-check: N of 5 right (wrong ones: PR or commit links)`
7. Report to Bernat in 3 bullets: those counts, any listing whose status, deadline, amount or eligibility changed (with links), and any wrong auto-commit. A wrong auto-commit is the revisit signal for 2026-12-15.
