---
id: programme-page
actors: [operator]
routes: [/p/<id>/]
source_paths:
  - src/pages/p/[id].astro
  - src/components/BeforeYouApply.astro
  - src/lib/format.ts
proof: browser
---

# Programme page

An operator opening `/p/<id>/` sees the reviewed "Before you apply" items in the funder's terms, each with its
quote and source, and "The funder's pages don't say" or "Not checked yet" where a fact is unknown.

## Source Coverage

- `src/pages/p/[id].astro` and `BeforeYouApply.astro` render the items; `effortSignals` in `src/lib/format.ts`
  turns them into the finder bars.

## User Journey

1. `bun run dev`, open `http://localhost:4321/p/<id>/#before-title`.
2. Each rule, document and step shows; each opens its quote and source.

## Failure Modes

- The dev server started before the data change shows old items: restart it.
- An emptied field shows "Not checked yet" when `requirements_checked` is unset, "The funder's pages don't say"
  when it is set.

## Proof Checklist

- [ ] A screenshot of `#before-title` for the programme the review changed most.
- [ ] The items on the page match `data/programmes/<id>.json`.
