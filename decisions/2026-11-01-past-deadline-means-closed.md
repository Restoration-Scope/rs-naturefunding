---
title: A call whose stated deadline has passed is closed, even if the page still says open
status: open
kind: long-term
filed: 2026-11-01
by: naturefunding data thread
undo: Remove the "open, but the deadline passed" check in src/data/schema.ts and set the status from the page's wording only.
---

## Decision

Where a page still says a call "is open" but states a deadline that has passed (Conservation Leadership Programme, Whitley Award, 30 October 2026), the call is `closed` and its status quote is the deadline sentence. Same for rounds whose stated window ended (NFWF Coastal Resilience, Disney, Prince Albert II Foundation, Global EbA small grants).

## Why

Funders forget to update banners. Showing "open" for a round that ended sends people to a dead form. The date is the funder's own, so this reads the page, not a guess.

## Where

- src/data/schema.ts (call status checks)
