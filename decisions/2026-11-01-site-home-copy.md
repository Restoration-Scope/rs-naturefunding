---
title: Home headline and lede copy
status: open
kind: assumption
filed: 2026-11-01
by: naturefunding site thread
undo: Edit the h1 and .band__lede in src/pages/index.astro, and the matching og.png text in src/lib/og-card.html.
---

## Decision

Headline: "Funding for nature restoration and conservation, checked against each funder’s own page." Lede: "Every deadline, amount and eligibility rule links to the funder’s own page, with the words it rests on and the date we read it. Free, with no paid listings or paid ranking. Built openly by Restoration Scope." Phones drop the first sentence of the lede (the headline already says it) and the stats line, so the first grant shows sooner. The stats line counts "programmes taking applications" (open or rolling), not calls. The OG image repeats the headline.

"Funding", not "Grants": a few listings (Ecosia, Arbor Day) are paid planting partnerships, not grants. "Links to … with the words it rests on" replaces "quoted": summaries and classifications are ours, so not every word on a page is the funder's.

![Home band](media/site-home-copy-1.png)

## Why

It says what this is, why to trust it, and who builds it in one screen, which the brief asked for. I passed on a benefit-led line ("Find funding for your project"), because every directory says that and trust is what sets this one apart.

## Where

- src/pages/index.astro
- public/og.png
