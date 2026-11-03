---
title: PostHog analytics, cookieless
status: open
kind: long-term
filed: 2026-11-02
by: PostHog setup thread
undo: Delete the relay Worker (relay/, `wrangler delete --config relay/wrangler.jsonc`) and the <script> at the end of src/layouts/Base.astro and the PUBLIC_POSTHOG_KEY env on the deploy build step, then `bun remove posthog-js`. Or just delete the PUBLIC_POSTHOG_KEY Actions variable and redeploy.
---

## Decision

Every page loads PostHog (project "Nature Funding.org", 706226) in cookieless mode: no cookies, no local or session storage, no cookie banner. Visitors are counted by a daily hash on PostHog's servers. Session replay and surveys are off; IPs are anonymized; autocapture, page views, web vitals and heatmaps are on.

## Why

The original brief allowed PostHog only cookieless, and a neutral site shouldn't ask visitors to accept tracking. The key lives in a GitHub Actions variable, so local builds ship no script and send nothing. Requests go through a small relay Worker on relay.naturefunding.org, so ad blockers that drop PostHog's own hosts still count the visit; passed on: PostHog's managed proxy (a paid add-on).

## Context

The privacy page promised "no tracking or analytics scripts". The PR rewrites it to disclose PostHog (US, pages and clicks, no IP kept, no recordings, daily hash) and holds the merge until that copy is approved.

## Where

- src/layouts/Base.astro
- .github/workflows/deploy.yml
- src/pages/privacy.astro
- relay/ (the Worker)
- PostHog project settings: https://us.posthog.com/project/706226/settings/project
