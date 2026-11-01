---
title: Site look is a field kit, with stamped "Checked" tags and flagging-tape status labels
status: reverted
kind: long-term
filed: 2026-11-01
by: naturefunding site thread
undo: Replace the tokens in src/styles/global.css (colours, .tape, .tag) and the @font-face rules; components read only those tokens, so pages follow.
---

## Decision

The site looks like a restoration field kit. Each fact has a stamped aluminium "Checked 1 Nov 2026" tag with a punched hole. Status is a strip of flagging tape (lime open, blue rolling, orange upcoming, grey closed). The header band is dark spruce on a cool aluminium page, with matching dark mode. The type is Atkinson Hyperlegible Next for text and its Mono for stamped data.

![Finder, desktop light](media/site-look-field-kit-1.png)
![Finder, phone dark](media/site-look-field-kit-2.png)
![Partner programme, phone](media/site-look-field-kit-3.png)
![Partner programme, desktop dark](media/site-look-field-kit-4.png)

## Why

The product's promise is "checked against the funder's page", so the checked date is the signature element instead of decoration. Atkinson Hyperlegible was designed for low-vision and second-language readers. Its slashed zero has no alternate, and the critic disliked it in amounts; I kept it for legibility. I passed on a generic green "nature" look and a card grid.

## Where

- src/styles/global.css
- .impeccable/surfaces/src-pages-index-astro.md

## Feedback

- 2026-11-01: Replaced by Bernat's choices (Restoration Scope palette, Geist Serif and Inter, shadcn, light only). The current look is in 2026-11-01-site-look-rs-palette.md.
