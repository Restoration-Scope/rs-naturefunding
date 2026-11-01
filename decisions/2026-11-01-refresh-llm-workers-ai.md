---
title: Changed pages are re-read by Workers AI on the deploy token, about $0/month
status: open
kind: temporary
filed: 2026-11-01
by: nf-refresh (refresh job and CI)
undo: Remove the Workers AI Read permission from the CLOUDFLARE_API_TOKEN token; changed pages then open an issue each instead of a PR. Or set LLM_EXTRACTOR / LLM_REVIEWER repo variables to other Workers AI models.
revisit: 2026-11-15, with the auto-merge review (agreement rate and any quota misses)
---

## Decision

Tier B uses Workers AI on Bernat's personal Cloudflare account (the one the site deploys to): `@cf/openai/gpt-oss-120b` extracts each fact with a verbatim quote, `@cf/meta/llama-4-scout-17b-16e-instruct` (another family) reviews the draft against the page. Code then checks every quote is on the page; a fact without its quote never moves. It runs on the deploy token (`CLOUDFLARE_API_TOKEN`) with one extra permission, Workers AI Read, so Bernat makes one token, not two. Only the step that reads pages sees it.

Expected cost: **$0/month.** A changed page costs about 1,000 neurons (two calls of ~15k tokens in, ~1k out), about $0.01 at list price; the free allocation is 10,000 neurons a day, about 10 changed pages a day. The first run saw 1 changed page out of 221. On the free plan, a day over the allocation turns the extra pages into issues; nothing is billed.

## Why

The first choice, GitHub Models through the workflow's own token, was retired on 2026-07-30: models.github.ai now answers every request with a plain "OK" (first proof run, issue #2). Workers AI was the filed fallback and needs no new account. Passed on: Anthropic or OpenAI keys (a credential on a paid account, and no key exists for this repo); a separate AI-only token (a second step for Bernat for the same blast radius, since both workflows run only main's code).

## Context

- Page text is cut at 60,000 characters; the PR says when it was cut.
- Any change in page text opens a PR, even when no fact changed (titled "dates only"). If noisy pages make that a daily chore, the next step is to auto-commit when the extractor and reviewer agree nothing changed and every quote is present.
- If a model is retired, Tier B opens an issue with the provider's error; set LLM_EXTRACTOR or LLM_REVIEWER to a listed model (`bun scripts/refresh/llm.ts --models` lists them).

## Where

- scripts/refresh/llm.ts, scripts/refresh/tier-b.ts
- .github/workflows/refresh.yml
