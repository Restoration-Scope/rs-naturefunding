---
title: No analytics in V1
status: open
kind: temporary
filed: 2026-11-01
by: naturefunding site thread
undo: Add the Cloudflare Web Analytics beacon (cookieless, one script tag) to src/layouts/Base.astro, or PostHog with persistence 'memory' and a project key.
revisit: after launch, if traffic numbers are needed
---

## Decision

The site ships without any analytics script.

## Why

The brief allowed PostHog only if it runs cookieless. That's possible (persistence: memory), but it needs a project key and a third-party script on every page of a site sold as neutral. Cloudflare Web Analytics is cookieless, free and already where the site is hosted, so it's the better first step when numbers are wanted. UTM links on the Restoration Scope footer and reporting links already show referrals in RS's own analytics.

## Where

- src/layouts/Base.astro
