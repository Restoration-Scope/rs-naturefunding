---
title: Funders whose sites block automated reading are left out for now
status: open
kind: temporary
filed: 2026-11-01
by: naturefunding data thread
undo: Add the programmes with method "human" evidence read in a browser, and teach verify-quotes to skip human evidence while the refresh job queues those pages for a person.
revisit: when the refresh job has a manual-check queue
---

## Decision

Programmes whose only first-party pages refuse automated fetching are not listed in V1: GEF Small Grants Kenya, Ethiopia, Mexico, Ghana and Mozambique (undp.org pages blocked; their strategy PDFs state no application route), US Fish and Wildlife international grants and African Elephant Fund (fws.gov), USDA Landscape Scale Restoration, National Forest Foundation, One Tree Planted, Global Greengrants, WWF Education for Nature, SeaWorld Conservation Fund, Patagonia.

## Why

Every quote must verify against the live page, and the daily refresh must re-read it. A fact nobody can re-check goes stale silently. Passed on: listing them with browser-read quotes now, which the checker and refresh can't confirm.

## Where

- scratchpad merge log; naturefunding-fetch-spike.md (notes folder)
