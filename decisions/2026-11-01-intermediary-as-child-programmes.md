---
title: Programmes run through country offices or hotspots are child programmes
status: open
kind: long-term
filed: 2026-11-01
by: naturefunding data thread
undo: Fold each child file into its parent as a list of channels, drop the `parent` and `administered_by` fields from src/data/schema.ts, and update the site's programme page.
---

## Decision

GEF Small Grants and CEPF each get an umbrella programme (`gef-sgp`, `cepf`) with `access: intermediary` and no calls, plus one programme file per country or hotspot (`gef-sgp-india`, `cepf-<hotspot>`) with `parent`, `administered_by` (the national host or Regional Implementation Team) and its own calls.

## Why

Each country or hotspot has its own page, deadline, amount and eligibility, so it filters and refreshes like any other programme. A visitor in Indonesia finds the Indonesian call directly. Passed on: one GEF SGP file with a nested list of country calls, which would need a second shape for the site and the refresh job.

## Where

- src/data/schema.ts (`parent`, `administered_by`, the access rules)
- data/README.md ("The four shapes")
