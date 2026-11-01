---
title: A deadline whose page gives no year stays empty, enforced by the schema
status: open
kind: long-term
filed: 2026-11-01
by: naturefunding data thread
undo: Delete the statesYear check in src/data/schema.ts.
---

## Decision

When a funder states a recurring window without a year ("October 15 to December 22", "March 1, July 1, October 1 each year"), the call keeps `deadline` and `opens` null and shows the window in its label. The schema now rejects any date whose quote doesn't contain its year: the four digits, or a short form that can only be a year ("'26", "04/01/27"). A bare "26" doesn't count, since it may be the day ("closes 26 November"); the first version of the check let that through, and the PR #1 review caught it.

## Why

Bernat's rule: never infer a deadline. Picking the year is inference, even when it looks obvious. Two drafts (CFHF, Ernest Kleinwort medium grants) had done it; Rainforest Trust large awards had not. The check turns the rule into a build failure. Passed on: a "recurring window" field the site could turn into a next date; worth adding if many funders work this way.

## Where

- src/data/schema.ts (`statesYear`)
- data/programmes/cfhf-grants.json, ekct-medium-grants.json, rainforest-trust-area-creation-awards-large.json
