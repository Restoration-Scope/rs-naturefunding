---
title: The Restoration Scope reporting link points to /solutions/funders
status: open
kind: temporary
filed: 2026-11-01
by: naturefunding site thread
undo: Change RS_REPORTING_URL in src/lib/site.ts, or remove the .aside paragraph in src/pages/p/[id].astro.
revisit: when Restoration Scope publishes funder-reporting guides
---

## Decision

Programme pages with a reporting field end their reporting section with a small note under a dashed rule: "From the builders of this site: Restoration Scope makes software for reporting to funders like this one." It links to restorationscope.com/solutions/funders with UTM tags. There are no pop-ups or gates.

## Why

The brief asks for a light link to RS funder-reporting guides, but none exist yet, so it points to the nearest real page. The round-1 critic called the line an ad on a neutral page. I kept it because the brief requires it, labelled it plainly as coming from the builders, and set it apart from the funder's facts.

## Where

- src/lib/site.ts
- src/pages/p/[id].astro
