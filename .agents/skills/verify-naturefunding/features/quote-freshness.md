---
id: quote-freshness
actors: [refresh job, maintainer]
routes: []
source_paths:
  - scripts/data/verify-quotes.ts
  - scripts/refresh/**
  - scripts/requirements/leads.ts
  - data/sources.json
  - .github/workflows/refresh.yml
proof: cli
---

# Quote freshness

Facts already listed still say what the funder's page says today. A quote that left its page is a lead to
reread the programme, never a silent edit.

## Source Coverage

- `verify-quotes.ts` (every quote on its cited page, `--fresh` to bypass the cache).
- The refresh job (`refresh.yml`, `scripts/refresh/run.ts`) reads watched sources by cycle and opens PRs for
  changes; `weekly.ts` lists leads from `leads.ts`.

## User Journey

1. `bun run verify-quotes -- <ids…>` reports each missing quote with its URL.
2. A missing quote on a changed page sends the programme back to requirements-reading, then second-reader.

## Failure Modes

- A page that refuses our user agent reads as missing: check the browser copy before calling a quote stale.
- A selector that no longer matches drops text: `page-text.ts` reads the whole page when no selector is set.

## Proof Checklist

- [ ] `verify-quotes` output for the ids, with each miss classed as page changed, page refused or selector.
- [ ] Every stale programme has been reread and reviewed, or is listed as a lead.
