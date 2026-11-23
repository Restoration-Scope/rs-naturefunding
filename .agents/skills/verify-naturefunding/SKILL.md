---
name: verify-naturefunding
description: Verify naturefunding.org work with real proof. Use before landing any batch of programme readings ("Before you apply" requirements or listing facts), after any change to scripts/requirements/, the review standards, lint checks or validate, and for changes to how a programme page shows its facts.
---

# Verify naturefunding.org

The outcome this skill proves: **what an operator reads on a programme page is what the funder's own page says
for the current round, and a second reader checked it.** A wrong rule costs an operator a wasted application;
an empty field costs nothing. Proof is about facts and their quotes first, pages second.

Pick the smallest feature in [features/README.md](features/README.md) that covers the claim, read it, run its
stages in order. Artifacts go under `.cache/verify/<task-slug>/` (git-ignored); quote what the PR needs into its
body.

## Standing rules

- `AGENTS.md` binds every stage: first-party only, never infer, honest user agent, no CAPTCHA or bot-check
  bypass.
- A model's agreement is never proof. Code checks what it can (schema, quote on page, stated dates, lint); a
  second reader from another model family rules on the rest, and canaries test the reader.
- Verification writes only under `.cache/`. Writing `data/` is landing: only `run.ts` and `review.ts apply`.

## Launch

- Work in a worktree on its own branch. Record `git rev-parse HEAD` and `git status --short` in the artifact
  README.
- `bun install --frozen-lockfile`.
- Page features only: `bun run dev` (Astro, port 4321). Restart it after any data change.

## Doctor

- `bun scripts/requirements/doctor.ts`: every line PASS, exit 0. A FAIL means a check the review relies on is
  broken: stop and fix it before trusting any review.
- `bun run validate`: `0 problems`, or you know which readings still wait for their second reader.
- Model stages: `cursor-agent --version` answers. Jev (`TYPESAFE_API_KEY`) lives only in GitHub secrets, so
  local runs pass `--no-jev`: say so in the proof.

## Drive

```bash
bun scripts/requirements/run.ts <ids…> --no-jev --cheap cursor:gpt-5.6-luna-high --strong cursor:gpt-5.6-sol-high --out .cache/requirements/runs/<slug>
```

```bash
bun scripts/requirements/review.ts brief <ids…>
```

Hand `brief.md` to one fresh reviewer from another model family than the extractor, never a fork of the thread
that briefed it (that thread has seen the canaries). For GPT extraction, on Cursor credits:
`cursor-agent -p --model claude-opus-5-thinking-high --trust < .cache/review/<stamp>/brief.md`, or a Claude
subagent. Then:

```bash
bun scripts/requirements/review.ts apply .cache/review/<stamp> --reviewer <model>
```

`apply` refuses a review with a missed canary or an item without a verdict, and restores every file if the data
or a new quote fails. A refused review goes to a different reviewer, not to a hand fix.

## Evidence

Keep per batch: the run's `report.json`, `brief.md`, `key.json` (from `~/.cache/naturefunding-review/<stamp>/`, after apply), `verdicts.jsonl`, the apply output (wrong and
missed counts, canaries caught), `bun run validate` and `bun run verify-quotes -- <ids>`. Open at least one
programme page per batch at `/p/<id>/#before-title` for the item the review changed most.

## Cleanup

- Stop only processes you started (dev server, model CLIs).
- `.cache/` is the audit trail: leave it.
- Report every boundary you didn't exercise (Jev off, a page that refused us, a page you didn't open).

## Stop conditions

- A canary missed: discard that reviewer's verdicts; brief another reviewer.
- Reviewers fault more than a third of a batch's items: stop bulk runs; find the cause in the labels
  (`tests/fixtures/review-labels/`) and fix the prompt, a lint check or the standards first.
- Doctor FAIL: fix the checks before any landing.
