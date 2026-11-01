---
title: Refresh changes need review for the first two weeks
status: open
kind: temporary
filed: 2026-11-01
by: 💰 Restoration grants & funding finder
undo: Turn auto-merge on for quote-verified, reviewer-approved changes (flag in the refresh workflow).
revisit: 2026-11-15, with the measured agreement between the extractor and the reviewer model
---

## Decision

The daily job auto-commits only "page unchanged, checked today" and "deadline passed, now closed". Any changed fact opens a pull request. For two weeks the orchestrator thread reviews them against the page; Bernat gets a weekly summary, not a queue.

## Why

The second-model check is unproven; a wrong deadline on a public directory costs trust. Two weeks gives a measured agreement rate before trusting it.
