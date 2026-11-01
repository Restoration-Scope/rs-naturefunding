---
title: "Developing countries" eligibility is mapped to world regions for the filters
status: open
kind: assumption
filed: 2026-11-01
by: naturefunding data thread
undo: Remove the `regions` array from the `regions` geography variant in src/data/schema.ts, keep only `label`, and have the site show those programmes under every region filter.
---

## Decision

When a funder states eligibility as a group without a country list ("emerging or developing economy countries", "ODA-eligible countries"), the file keeps the funder's wording as `label`, quotes it, and adds our mapping to world regions (Africa, Asia, Latin America and the Caribbean…) so region filters work.

## Why

Without a mapping these programmes vanish from region filters, and they are often the most relevant ones for the Global South. The mapping is ours, so the funder's wording is always shown next to it. Passed on: expanding to full country lists (the DAC list changes yearly and funders rarely link one).

## Context

Rufford maps to every region except North America, including Europe, since it funds projects in places such as Armenia.

## Where

- src/data/schema.ts (`geography`, scope `regions`)
- data/programmes/rufford-small-grants.json
