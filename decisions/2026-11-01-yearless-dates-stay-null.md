---
title: A deadline whose page gives no year stays empty, enforced by the schema
status: open
kind: long-term
filed: 2026-11-01
by: naturefunding data thread
undo: Delete the statesYear check in src/data/schema.ts.
---

## Decision

When a funder states a recurring window without a year ("October 15 to December 22", "March 1, July 1, October 1 each year"), the call keeps `deadline` and `opens` null and states the window in a `recurring` field with its own quote. Such a call is `open` only when the page says applications are being accepted now; otherwise it is `unknown` (CFHF and Ernest Kleinwort medium grants), because a yearless "open" would never expire. The schema now rejects any date whose quote doesn't contain its year: the four digits, or a short form that can only be a year ("Nov '26" with the apostrophe right after a month, or "04/01/27"). A bare "26" doesn't count, since it may be the day ("closes 26 November"); the first version of the check let that through, and the PR #1 review caught it.

## Why

Bernat's rule: never infer a deadline. Picking the year is inference, even when it looks obvious. Two drafts (CFHF, Ernest Kleinwort medium grants) had done it; Rainforest Trust large awards had not. The check turns the rule into a build failure. The `recurring` field came out of the Sol claim check: the label hid stated dates behind "Not stated", and yearless windows showed "Open now" forever. It is text in our words; the site shows it as is and never turns it into a next date.

## Where

- src/data/schema.ts (`statesYear`)
- data/programmes/cfhf-grants.json, ekct-medium-grants.json, rainforest-trust-area-creation-awards-large.json
