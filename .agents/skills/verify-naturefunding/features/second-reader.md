---
id: second-reader
actors: [reviewer, maintainer]
routes: []
source_paths:
  - scripts/requirements/review.ts
  - scripts/requirements/reviewer-run.ts
  - scripts/requirements/eval-reviewers.ts
  - scripts/requirements/lint.ts
  - scripts/requirements/doctor.ts
  - scripts/data/validate.ts
  - docs/review-standards.md
  - tests/fixtures/review-labels/**
proof: cli
---

# Second reader

Every "Before you apply" item a reading writes gets a verdict from a reviewer, a model other than the reading's, checked
against the documents it cites. The reviewer is tested with planted canaries, its verdicts are applied by code,
and the review is stamped so `validate` can tell reviewed readings from the rest.

## Source Coverage

- `review.ts brief`: standards from `docs/review-standards.md`, items and sources numbered, lint leads, canaries
  (a rule its real quote doesn't state, or a document no quote names) kept in `key.json` outside the worktree
  (`~/.cache/naturefunding-review/<stamp>/`).
- `review.ts apply`: verdict schema, coverage (one verdict per item and source), canaries, edits, new source
  rows, validate and `verify-quotes --fresh` with restore on failure, the `review` stamp in
  `data/requirements/<id>.json`, verdicts appended to the label set.
- Gate: `reviewProblems` in `validate.ts` for readings on or after `REVIEW_FROM`.

## User Journey

1. `review.ts brief <ids…>` prints the brief path and the canary count.
2. `review.ts run <dir>` runs the default reviewer (`REVIEWER`, gpt-6.2-sol on the ChatGPT plan), which writes
   `verdicts.jsonl`, one line per item, source and missed fact; then applies them. `apply <dir> --reviewer <model>`
   applies another model's verdicts.
3. Apply prints programmes changed, items wrong and missed, canaries caught.
4. `bun run validate` passes; the manifests carry `review.hash` matching the items.

## Failure Modes

- The reviewer misses a canary or skips items: apply refuses; brief another reviewer.
- A reviewer's new quote isn't on its page: apply restores every file.
- The file changed between brief and apply: apply refuses; brief again.
- A new quote past its field's cap, a reworded one-value field, or two changes to one: apply refuses, nothing
  written. Each kept document, step and after_award names its quotes (`quotes`); a quote no kept item names goes.
  Naming a quote from a dropped source, or citing one in a new quote, is refused.
- No programme in the brief can carry a canary: brief refuses.
- A reviewer that is one of the reading's models (from the manifest's `models`, route and effort ignored): apply refuses.
- Choosing a reviewer: `eval-reviewers.ts` (brief, run, score), then settle disputed items on the funders' pages with
  two judges of different families. Canaries and agreement don't separate models: all caught 8/8 on 2026-11-24.
- A later hand edit to reviewed items: validate fails until a new review.

## Proof Checklist

- [ ] Doctor passes (canary, coverage and gate faults included).
- [ ] Apply output: canaries caught equals planted; wrong and missed counts recorded.
- [ ] `git diff data/` shows only the verdicts' edits, new source rows and `review` stamps.
- [ ] `bun run validate` passes, and apply's check of the review's new quotes passed. Older misses from
  `verify-quotes -- <ids…>` are classed (page changed, refused, selector) and listed, not fixed by the review.
