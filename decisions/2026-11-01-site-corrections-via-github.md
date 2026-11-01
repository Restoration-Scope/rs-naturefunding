---
title: "Report a problem" and funder corrections open a pre-filled GitHub issue
status: open
kind: temporary
filed: 2026-11-01
by: naturefunding site thread
undo: Point reportProblemUrl, funderCorrectionUrl and generalIssueUrl in src/lib/site.ts at a mailto or form URL.
revisit: when naturefunding.org has an inbox (e.g. corrections@naturefunding.org) or a no-login form
---

## Decision

Both links on every programme page, plus the footer and About links, open a GitHub issue with the programme name, id and a short template filled in, labelled `listing-problem` or `funder-correction`.

## Why

No inbox exists, and the issue gives a public, reviewable trail, which suits the trust story. The critic objected that most community groups and funders' comms staff have no GitHub account. A mailto or a no-login form should become the main route once there's an inbox. Only Bernat can create one.

## Where

- src/lib/site.ts
