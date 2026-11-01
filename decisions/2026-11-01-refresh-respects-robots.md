---
title: The refresh job obeys robots.txt, so Darwin Plus and IWT Challenge Fund are never re-read automatically
status: open
kind: long-term
filed: 2026-11-01
by: nf-refresh (refresh job and CI)
undo: Drop the robotsAllows check in scripts/refresh/fetch.ts (readPage) for those hosts or all hosts.
---

## Decision

Before reading a page the job checks the host's robots.txt for its own user agent (`naturefunding-refresh`) and `*`. darwinplus.org.uk and iwt.challengefund.org.uk say `Disallow: /` to every bot, so their 20 watched pages (7 programmes) are recorded as blocked every day, never dated, and listed in the weekly summary as failing.

## Why

A public directory that ignores a funder's "no bots" rule can be named and blocked, and the job is meant to be polite. One request a day is small, but the rule is explicit. Passed on: ignoring robots.txt for single pages a person once read.

## Context

Those listings will go stale after 30 days unless someone re-reads them by hand (evidence `method: "human"`) or asks the funders (Defra's Biodiversity Challenge Funds) to allow the agent.

## Where

- scripts/refresh/fetch.ts
