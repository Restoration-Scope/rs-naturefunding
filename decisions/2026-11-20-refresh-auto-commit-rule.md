---
title: Refresh commits changes only when the reviewer finds nothing wrong; dates stop waiting on PRs
status: open
kind: temporary
filed: 2026-11-20
by: Refresh PR backlog triage
undo: Set the refresh job back to "every changed fact opens a PR" (one revert of the job change); reopen any closed refresh PR from its "Closed" list.
revisit: 2026-12-15, after spot-checking 20 auto-committed changes against their pages
---

## Decision

Revisits [the 1 Nov call](2026-11-01-refresh-auto-merge-off.md). Nothing is built or merged yet; approving this lets me build it:

1. **Dates don't wait on PRs.** When a page changed but a fact's quote is still verbatim on it, the job dates that fact today on main, without accepting the new page version. This ends stale `checked_at` for every page behind an open PR, with no merging.
2. **Auto-commit at draft time** (straight to main, no PR) only when the reviewer says approve, marks every applied row "supported", flags nothing missed, no row was rejected and no quote went missing. On today's backlog that is 41 of 253 PRs.
3. **Close the backlog once 1–2 ship.** The job re-drafts each page from current main: the ones that pass commit, the rest come back as fresh PRs without conflicts.
4. **Everything else needs a person.** An agent thread checks those PRs against the page each week, then merges or closes them. You get a summary, not a queue.

**Catch:** the reviewer is a small model. My own read of the 24 cleanest PRs found 3 doubtful rows out of about 35: #780 drops `community_group` from applicant types, #778 adds reporting from a weak quote, #685 only rewords. Some wrong facts would go live, including in the applicant-type and region filters, with no person looking.

## Why

- **The backlog (253 open, from 3 Nov):** 82 dates-only, 112 reviewer-approved, 59 reject or unclear. 64 already conflict with main, and 26 programme files have 2 or more PRs, so merges collide. 0 refresh PRs have ever merged; 354 were closed, mostly superseded. It's 253 now, not 147, because today's run opened 145 new PRs.
- **Passed on "auto-merge dates-only":** 62 of the 82 carry rejected facts, such as a new call that failed the schema, and 46 have the reviewer saying something was missed. Merging accepts the page version, so those facts stay buried until the page changes again. Only 5 are clean.
- **Passed on a looser rule** (approve with no rejected row, "missed" allowed): it clears 59, but "missed" is where the reviewer reports contradicting deadlines or amounts.
- **"Schema: valid" tells us nothing:** it shows on all 253, because drafts that fail the schema become issues instead of PRs.
- **Reviewer verdicts:** on approved PRs, 201 applied rows were supported and 6 unsupported. 31 rejects have every row supported, so a reject usually means "you missed something", not "this is wrong".
- **SEO window:** the job only writes administered_by, applicant_types, geography, access, window, amount, co_finance_required, reporting, calls and their evidence. It never writes names, ids, slugs or the sitemap. A call's link can change (#827 changes `Behoerde` to `Behörde`), but that is never a site URL.

## Where

- Sort with PR numbers: `refresh-backlog-2026-11-20.md` in the side-session notes folder
- `scripts/refresh/run.ts` (draftFor), `scripts/refresh/open-prs.ts`, `scripts/refresh/tier-b.ts`
- Closed #67: its source `cepf-indo-burma-4` is no longer watched. No PR was a duplicate of a newer one: `open-prs.ts` already closes those.
