---
title: Funder page snapshots are not committed to the public repo
status: open
kind: long-term
filed: 2026-11-01
by: 💰 Restoration grants & funding finder
undo: Commit normalized page text under data/snapshots/ and make CI check quotes against it.
---

## Decision

Quotes are checked against the funder's live page at the moment we read it, and we store only the quote, the date and a hash of the page text. The full page text is not committed.

## Why

Republishing whole funder pages in a public repo copies their text wholesale. Short quotes with links are enough to show where each fact came from. The catch: CI can't re-check quotes offline; the refresh job re-checks them every run instead.
