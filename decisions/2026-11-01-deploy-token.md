---
title: Deploys and page re-reads need one Cloudflare token from Bernat; until then CI builds but does not deploy
status: open
kind: temporary
filed: 2026-11-01
by: nf-refresh (refresh job and CI)
undo: Delete the CLOUDFLARE_API_TOKEN secret and revoke the token in Cloudflare; deploy.yml goes back to build-only with a warning and changed pages open issues instead of PRs.
revisit: when the token is set (first green deploy)
---

## Decision

`deploy.yml` builds on every push to main (and after each refresh commit) and runs `wrangler deploy` only when the `CLOUDFLARE_API_TOKEN` Actions secret exists. The refresh job uses the same token for Workers AI (decisions/2026-11-01-refresh-llm-workers-ai.md). It is the only secret the repo needs.

## Why

The token is a credential on Bernat's personal Cloudflare account and the repo is public, so creating it is his call, and the agents' logins can't mint one without its value passing through a chat. Scope: the "Edit Cloudflare Workers" template plus Workers AI Read, limited to account c7279249… (personal) and no zones, so a leak can only replace this site's static files or run models on the free allocation.

## Context

Bernat's two steps: create the token at https://dash.cloudflare.com/profile/api-tokens (template "Edit Cloudflare Workers"; add a permission row Account → Workers AI → Read; Account resources: Bernatfortet@gmail.com's Account; Zone resources: none), press Copy, then run from any folder:
`pbpaste | gh secret set CLOUDFLARE_API_TOKEN -R Restoration-Scope/rs-naturefunding && pbcopy < /dev/null`

## Where

- .github/workflows/deploy.yml
