---
id: requirements-reading
actors: [pipeline, maintainer]
routes: []
source_paths:
  - scripts/requirements/run.ts
  - scripts/requirements/pipeline.ts
  - scripts/requirements/gather.ts
  - scripts/requirements/extract.ts
  - scripts/requirements/verify.ts
  - scripts/requirements/check.ts
  - scripts/requirements/write.ts
  - scripts/requirements/lint.ts
  - scripts/data/page-text.ts
  - src/data/schema.ts
  - data/README.md
  - docs/requirements-pipeline.md
proof: cli
---

# Requirements reading

A programme's eligibility rules, first-step documents, application steps, co-funding, consortium and after-award
duties are read from the funder's own current pages and linked guidelines, each item with a verbatim quote on a
page we cite. What the pages don't state stays empty.

## Source Coverage

- Gather: `gather.ts` crawls the call page and linked documents (bounded), `page-text.ts` turns HTML into the
  text quotes are checked against, `browser-reads.ts` holds one-time browser copies of pages that refuse us.
- Extract and escalate: `extract.ts`, `pipeline.ts` (cheap model, then the strong model on flagged fields).
- Verify: `verify.ts` (quote on a gathered document, lengths, stated dates, typed numbers in their quote).
- Write: `write.ts` (programme file, manifest in `data/requirements/`, new source rows).
- Leads for the reviewer: `lint.ts`, scored against `tests/fixtures/review-labels/`.
- Accuracy: `eval.ts` against the gold set in `tests/fixtures/requirements/`.

## User Journey

1. `run.ts <ids…>` writes each programme and its manifest; `report.json` lists outcomes per field and cost.
2. `bun run validate --no-review` passes: schema, evidence counts, due dates stated by their quotes.
3. `bun run verify-quotes -- <ids…>` finds every quote on its page.
4. The second reader takes over (second-reader).

## Failure Modes

- A quote from a sibling programme's RFP or an older round on the same site: code passes it; only the reader's
  per-source check catches it (27 of 147 faults in the 2026-11-23 labels).
- A rule that says more than its quote, a selection criterion as a rule, either/or routes split: model-only
  catches.
- A page that refuses our fetcher or a PDF without text: coverage incomplete, `requirements_checked` unset.
- A prompt change that looks better on three programmes: noise until `run.ts --gold` + `eval.ts` say otherwise.

## Proof Checklist

- [ ] Doctor passes.
- [ ] `report.json` shows the models the CLI reported and Jev on or off.
- [ ] `validate --no-review` and `verify-quotes` pass for the ids.
- [ ] For a prompt or model change: `eval.ts` on the held split, compared with the last score.
