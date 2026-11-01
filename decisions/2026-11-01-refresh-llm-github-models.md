---
title: Changed pages are re-read by GitHub Models, free, with no new secret
status: open
kind: temporary
filed: 2026-11-01
by: nf-refresh (refresh job and CI)
undo: Set the repo variable LLM_PROVIDER=cloudflare and add the CLOUDFLARE_AI_TOKEN secret (Workers AI Read on the personal account); scripts/refresh/llm.ts already speaks to it. Or point LLM_EXTRACTOR / LLM_REVIEWER at other models.
revisit: 2026-11-15, with the auto-merge review (agreement rate and any rate-limit misses)
---

## Decision

Tier B uses GitHub Models through the workflow's own `GITHUB_TOKEN` (`models: read`): `openai/gpt-4.1` extracts each fact with a verbatim quote, `meta/llama-4-maverick` (another family) reviews the draft against the page. Code then checks every quote is on the page; a fact without its quote never moves. Expected cost: **$0/month**.

## Why

Smallest setup that works: no key to create, store or rotate, and nothing billed. Only changed pages reach a model (a few a day across ~150 watched pages; the free tier allows ~50 calls a day on gpt-4.1), so cost stays bounded by design. Passed on: Anthropic/OpenAI keys (none exists for this repo; adding one is a credential on a paid account) and Workers AI first (needs a Cloudflare token Bernat must make).

## Context

- The free tier caps input near 8k tokens, so page text is cut at 16,000 characters; the PR says when it was cut. Long PDF calls may lose facts past that point; the reviewer and the "not confirmed" list surface it.
- Any change in page text opens a PR, even when no fact changed (titled "dates only"). If noisy pages make that a daily chore, the next step is to auto-commit when the extractor and reviewer agree nothing changed and every quote is present.
- If the org turns GitHub Models off, Tier B still opens an issue per changed page saying it could not re-read it; nothing is guessed.

## Where

- scripts/refresh/llm.ts, scripts/refresh/tier-b.ts
- .github/workflows/refresh.yml
