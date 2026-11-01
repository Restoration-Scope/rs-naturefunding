---
title: Listings live as JSON files in git, not a database
status: open
kind: long-term
filed: 2026-11-01
by: 💰 Restoration grants & funding finder
undo: Load data/programmes/*.json into a Postgres or D1 table with the same zod schema and point the build at it; the schema in src/data/schema.ts stays the contract.
---

## Decision

Each programme is one JSON file in `data/programmes/`, checked by the zod schema in `src/data/schema.ts`. The site is built from those files; there is no database.

## Why

A few hundred listings fit in files. Git gives every change a reviewable diff, a date and an author, which is the trust story ("see how each fact changed"). It also needs no server, matching the free-tools rule. The council (Astra, Sol, Opus, Fable) agreed. Passed on: Postgres or D1, which pays off only with accounts, funder logins or thousands of rows.

## Where

- src/data/schema.ts
- ~/.council/naturefunding-shape-20261101/decision.md
