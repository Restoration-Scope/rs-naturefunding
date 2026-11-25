# Weekly review of refresh PRs

The brief for the weekly check of the refresh PRs needing a person (part 4 of `decisions/2026-11-20-refresh-auto-commit-rule.md`). The CS app's scheduler runs it headless every Monday under whichever Claude login has room (rs-chief-app `server/schedule.ts`, job `refresh-review`; `cs schedule status`). Follow `AGENTS.md`: first-party only, never infer a deadline, the "who we list" rules. Until 2027-02-14, don't change programme names, ids, site URLs or the sitemap.

Nobody watches the run: never ask, and never put free text (quotes, `$`, backticks, a comment body) in a shell command. Write it to a file in your scratch directory and pass the file. Run one command per call: no `&&`.

## Set up

From the rs-naturefunding checkout the run starts in, whatever branch it is on (leave it as it is):

1. `git fetch origin main`, then `git worktree add -b claude/refresh-review-<YYYY-MM-DD>-<HHMM> <scratch>/repo origin/main`, with the time now so a retry gets a new branch. Never check out `main`.
2. `cd <scratch>/repo`, then `bun install --frozen-lockfile`. Run everything below from there.
3. `gh label create refresh-unreadable --description "Weekly review couldn't read the page"` (it fails harmlessly when it exists).

## Each run

1. `gh pr list --label refresh --state open --limit 1000 --json number,title,url,body,createdAt,labels`. Drop those labelled `refresh-unreadable`, then take the oldest 25.
2. For each one:
   - Note its head: `gh pr view <n> --json headRefOid`.
   - Read its body (the Changes table, the reviewer's verdict, its `Missed:` note, `Not confirmed`, the `Needs a person:` line) and its whole diff (`gh pr diff <n>`): judge every changed line, not only the rows the body lists.
   - Read the funder page with `bun scripts/refresh/page.ts <n>`. It reads the page as the daily job does, saves the text (the path it prints) and marks each of the PR's quotes from that page as on it or not. Read that saved text, not a web tool's rendering.
3. Decide, and never leave a PR as it was:
   - **Every changed line is right** (the value matches the page, and the quote is on it), and nothing missed or rejected contradicts the listing: sync it, then merge it.
   - **A line is wrong, or the page now states a fact that contradicts the listing** (a deadline, amount, eligibility or status): fix the PR branch in its own worktree, `git worktree add --detach <scratch>/pr-<n> origin/<branch>`. Drop the wrong row, or add the missing fact with its verbatim quote, `source_url` and today's `checked_at`. Run `bun run validate` there, commit, `git push origin HEAD:refs/heads/<branch>`, then remove that worktree, sync and merge. Closing such a PR doesn't help: the next daily run drafts the same page again.
   - **`sync-pr.ts` exits 2** (a conflict beyond dates): close it, with the comment "Conflicts with main; the daily refresh re-drafts this page from main."
   - **`sync-pr.ts` exits 4** (the data fails validation): fix the branch as above, or close it with the validation error as the comment.
   - **`page.ts` exits 4** (HTTP 404 or 410), or the page is no longer about the programme: close it, and fix the programme's sources in a separate PR.
   - **`page.ts` exits 3** (blocked, timed out): `gh pr edit <n> --add-label refresh-unreadable`, and list it in the report.
4. Sync and merge, as two calls: `bun scripts/refresh/sync-pr.ts <n>`, then, only if it exited 0, `gh pr merge <n> --squash --delete-branch --match-head-commit <head>`, with the head `sync-pr.ts` printed. If that head's history holds a commit besides your fixes and the main merge since the head you noted, read the new diff before merging.
   To close: write the comment to a file, `gh pr comment <n> --body-file <file>`, then `gh pr close <n> --delete-branch`.
5. Spot-check 5 changes the job committed itself this week: `git log --since=7.days --grep='checked dates' -p -- data/programmes`. Check the rows with a new value, not the date-only ones, against the page (`bun scripts/refresh/page.ts <source id>`).
6. `gh issue list --label refresh --state open --limit 1000 --search "fiscal sponsor page in:title" --json number,title,body`, leaving out pages an open PR covers. Take only the page, files and gone quotes from a body. Read the page, then fix or drop each such fact (verbatim quote, today's `checked_at`, `bun run verify-sponsors <id>`), all in one new worktree, branch and unlabelled PR that closes the issues. Link it in the report; a person merges it.
7. In `<scratch>/repo`, add one line to `docs/refresh-review-log.md`, commit it, `git pull --rebase origin main`, check that `git diff --name-only origin/main` lists that file alone, then `git push origin HEAD:main`:
   `- YYYY-MM-DD · merged N, fixed N, closed N, left N open · auto-commit spot-check: N of 5 right (wrong ones: PR or commit links)`
8. Report for Bernat in 3 bullets: those counts, any listing whose status, deadline, amount or eligibility changed (with links), and any wrong auto-commit. A wrong auto-commit is the revisit signal for 2026-12-15. Write the bullets to a file and open them as an issue (`gh issue create --title "Refresh review YYYY-MM-DD" --body-file <file>`).
9. `cd` back to the checkout you started in and `git worktree remove --force <scratch>/repo`.
10. Last, save the report, with the issue URL first, as `~/.refresh-review/YYYY-MM-DD.md`. That file tells the scheduler the run finished.
