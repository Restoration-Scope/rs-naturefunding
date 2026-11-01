---
title: Usual grant ranges are flagged as typical, not limits
status: approved
kind: long-term
filed: 2026-11-01
by: naturefunding data thread
undo: Remove `typical` from `amount` in src/data/schema.ts and from the five programme files.
---

## Decision

`amount` gains `typical: true` when the funder gives a usual range ("tends to fund", "typically", "generally", "indicative") rather than hard limits: Blue Action Fund, Elephant Crisis Fund, Lion Recovery Fund, Protect-an-Acre, IUCN's blue natural capital facility. The site can say "usually" next to those.

## Why

Showing a typical range as a min and max overstates the rule and can put off applicants just outside it. Passed on: leaving those amounts null, which hides useful guidance.

## Where

- src/data/schema.ts (`amount`)
