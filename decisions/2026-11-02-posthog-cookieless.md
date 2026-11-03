---
title: PostHog analytics, cookieless
status: open
kind: long-term
filed: 2026-11-02
by: PostHog setup thread
undo: Delete the <script> at the end of src/layouts/Base.astro and the PUBLIC_POSTHOG_KEY env on the deploy build step, then `bun remove posthog-js`. Or just delete the PUBLIC_POSTHOG_KEY Actions variable and redeploy.
---

## Decision

Every page loads PostHog (project "Nature Funding.org", 706226) in cookieless mode: no cookies, no local or session storage, no cookie banner. Visitors are counted by a daily hash on PostHog's servers. Session replay and surveys are off; IPs are anonymized; autocapture, page views, web vitals and heatmaps are on.

## Why

The original brief allowed PostHog only cookieless, and a neutral site shouldn't ask visitors to accept tracking. The key lives in a GitHub Actions variable, so local and CI builds ship no script and send nothing. Passed on: a reverse proxy to dodge ad blockers (needs a Worker, which the site rules out).

## Context

The site doesn't mention analytics anywhere yet. A line on the About page ("We count visits with PostHog, without cookies") would match how open the rest of the site is; that's copy, so left for you.

## Where

- src/layouts/Base.astro
- .github/workflows/deploy.yml
- PostHog project settings: https://us.posthog.com/project/706226/settings/project
