---
title: The site deploys on Bernat's personal Cloudflare account
status: open
kind: temporary
filed: 2026-11-01
by: 💰 Restoration grants & funding finder
undo: Move the naturefunding.org zone to the Restoration Scope Cloudflare account (f28ebf06…), change account_id in wrangler.jsonc, redeploy.
revisit: when Restoration Scope moves its own zones to the RS account
---

## Decision

`wrangler.jsonc` deploys to the personal account (c7279249…), where Bernat bought the domain. A custom domain must sit in the same account as its zone.

## Why

Moving a zone is an account change only Bernat should make. Nothing else depends on which account hosts static files, so it can move later in minutes.
