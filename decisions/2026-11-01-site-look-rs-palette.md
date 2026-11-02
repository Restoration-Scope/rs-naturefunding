---
title: Site look follows Restoration Scope, polished page by page
status: open
kind: long-term
filed: 2026-11-01
by: naturefunding polish thread
undo: Revert the polish commits on claude/shadcn-ui (9e4a0af to the latest); the palette and fonts are tokens in src/styles/global.css.
---

## Decision

The site uses Restoration Scope's look: beige paper, a brand-green header band, Geist Serif headings and Inter text, light only. A polish pass then made the details consistent: funder marks beside names, sans bold names in every list, calls as cards sorted by deadline, a tablet filter panel, 44px touch targets on phones, a 404 page with search, and a new leaf mark, favicon and share card.

![Finder, desktop](media/site-look-rs-palette-1.webp)
![Finder, phone](media/site-look-rs-palette-2.webp)
![Programme page, desktop](media/site-look-rs-palette-3.webp)
![Share card](media/site-look-rs-palette-4.webp)

## Why

Bernat chose the palette, fonts and shadcn; the field-kit look before it is retired. Lists use the sans so long funder titles read as data, while the serif stays for page and section headings. Every quote and checked date stays visible.

## Where

- src/styles/global.css, src/styles/finder.css
- src/pages/index.astro, src/pages/p/[id].astro, src/components/Listing.astro
- .impeccable/surfaces/src-pages-index-astro.md
