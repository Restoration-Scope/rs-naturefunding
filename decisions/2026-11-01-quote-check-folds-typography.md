---
title: The quote check ignores case, quote marks, dashes and spacing
status: open
kind: long-term
filed: 2026-11-01
by: naturefunding data thread
undo: In scripts/data/page-text.ts, make `comparable` return `normalise(s)` without lowercasing (or drop the dash and quote folding), then rerun bun run verify-quotes and fix the quotes that fail.
---

## Decision

A quote passes when it appears on the funder's page after both are folded: Unicode NFKC, curly quotes to straight, every dash to a hyphen, runs of spaces to one, and lower case. Words and their order must match exactly.

## Why

Pages render the same sentence with different quote marks, non-breaking spaces or capitals set by CSS. A strict byte match would fail on typography while proving nothing more about the fact. Passed on: fuzzy matching, which could pass a quote with a changed number.

## Where

- scripts/data/page-text.ts (`normalise`, `comparable`)
- scripts/data/verify-quotes.ts
