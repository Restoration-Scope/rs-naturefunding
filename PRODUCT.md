# Product

<!-- impeccable:product-schema 1 -->

Inferred from the build brief (Bernat was away; no interview ran). Every section below comes from his written brief, the repo's AGENTS.md and README, and the research notes; nothing here is invented.

## Platform

web

## Users

- Staff at small and mid-size nature restoration and conservation organisations (NGOs, community groups, Indigenous organisations, researchers) looking for money they can actually apply for, usually from a laptop in an office or a phone in the field, often on slow connections and often not in their first language.
- Carbon and restoration project developers scanning for open calls.
- Funders checking how their programme is listed, and AI answer engines citing a plain, sourced page.

## Product Purpose

naturefunding.org is a free, neutral directory of grants and funding for nature restoration and conservation. It lists only what a funder's own page says, with the exact words and the date it was checked, so an applicant can trust a deadline without re-checking five directories. Success: an applicant finds a call they are eligible for, sees how to reach it (apply directly, via a partner, or invitation only), and trusts the deadline.

## Positioning

Every fact carries its source page, a verbatim quote and a checked date; nothing is copied from other directories, and deadlines are never inferred. No other directory filters by restoration approach, applicant type or access route, or shows "Checked <date> against <funder page>" on every listing.

## Operating Context

- Built and openly funded by Restoration Scope, which sells monitoring software to restoration NGOs, carbon developers and funders. The directory is a trust asset; the RS tie-in stays quiet (footer, light links to funder-reporting guides).
- A daily job re-reads funder pages; changes go through review before they are published.
- Competitor failure to avoid: listing a funder as "open until 2030" when it takes no applications.

## Capabilities and Constraints

- Static site (Astro, Bun) on Cloudflare static assets. No server for visitors, no accounts, no pop-ups, no gates. Search and filters run in the browser.
- Open data: JSON, CSV, Atom feed. Data CC BY 4.0, code MIT.
- Rows unchecked for more than 30 days are flagged; more than 90 days are hidden.
- Email alerts are out of V1.

## Brand Commitments

- Name: naturefunding.org. Restoration Scope named openly as the builder.
- Neutral: no paid listings, no ranking by who pays.

## Evidence on Hand

- Programme data in `data/programmes/*.json` (being written by the data thread). Until then, clearly fake fixtures.
- No logos, photography, testimonials or partner endorsements exist. Do not fabricate any.

## Product Principles

1. The funder's own words beat ours: show the quote and the source wherever a fact appears.
2. Say "not stated" rather than guess.
3. Honest about access: invitation-only and via-a-partner routes are labelled as plainly as open calls.
4. Fast and readable on a cheap phone on a slow connection.

## Accessibility & Inclusion

WCAG AA. Works at phone width, in light and dark. Plain language for readers working in a second language.
