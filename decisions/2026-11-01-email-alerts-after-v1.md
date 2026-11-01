---
title: No email alerts in V1; an Atom feed instead
status: open
kind: temporary
filed: 2026-11-01
by: 💰 Restoration grants & funding finder
undo: Not needed; adding alerts is new work.
revisit: after launch, as a restoration-scope PR adding a naturefunding list to src/features/email-lists
---

## Decision

V1 ships an Atom feed of new and changed calls and promises no email alerts.

## Why

Reusing Restoration Scope's sign-up needs changes in the main repo (a new list, cross-origin support, a confirm page for this domain) and every send needs Bernat's yes today. Alerts are the main lead hook, so they come right after launch, with the question of standing approval for an automated digest.
