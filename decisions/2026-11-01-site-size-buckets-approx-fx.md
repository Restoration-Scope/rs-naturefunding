---
title: Grant-size filter converts amounts to US dollars with fixed rough rates
status: open
kind: assumption
filed: 2026-11-01
by: naturefunding site thread
undo: Drop the size filter (sizeBuckets in src/lib/labels.ts and the Grant size fieldset in src/pages/index.astro), or load rates at build time.
---

## Decision

The "Grant size" filter (under $25k, $25k–250k, over $250k) converts each amount to US dollars using a small fixed rate table. Listings always show the funder's own currency. The rough conversion is used only for the filter, and the filter says so.

## Why

Funders state amounts in USD, EUR, GBP, BRL, JPY and more, and a size filter is useful. Fetching live rates would need a build-time network call for a filter with coarse buckets.

## Where

- src/lib/data.ts (usdPerUnit)
