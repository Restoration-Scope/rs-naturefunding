# Requirements pipeline: filling the effort bars

The four finder bars are a pure function of structured facts (`effortSignals` in
`src/lib/format.ts`), computed at build. No model ever picks a colour. The work is
filling the facts behind them: `eligibility`, `documents`, `effort`, `co_finance`,
`co_finance_required`, `consortium_required`, `after_award` (with `reporting` kept
consistent) and `requirements_checked` (rules in `data/README.md`). This pipeline
does that for ~1,000 direct programmes once, then keeps them current.

Principle: code owns the workflow and every check it can state; models only read
language. A cheap model extracts from the full text, code verifies, Jev runs narrow
checks with enough context to judge, and only flagged items go to a strong model.
People see only what the strong model can't settle. Reviewed by Astra (high) on
2026-11-16; its findings are folded in below.

## Shape

A separate programme-level pipeline (`scripts/requirements/`), not more Tier B
`FIELDS`: requirements span several pages and PDFs, with array evidence, so they
are reconciled per programme, not patched per page. It shares the refresh code:
`fetch.ts`, `quoteOnPage`, `statesDate`, the strict schema, `llm.ts`, PR helpers.

## Stages (per programme)

| # | Stage | Who | What |
|---|---|---|---|
| 1 | Queue | script | A durable queue keyed by programme and input hashes. Enqueue: no `requirements_checked`; a watched document's content or link targets changed (refresh emits the event); an accepted new round; a check older than 12 months. Open and upcoming calls first. One writer per programme. |
| 2 | Gather | script + Jev | Seeds: the programme's cited pages and its current call pages. The fetch returns text with page boundaries and the link inventory with surrounding text. Follow document links within a bounded crawl (depth 2, 8 documents); Jev ranks ambiguous links, and a document's identity (programme, round) is confirmed from its own content, not its anchor. Keep linking page → document → final URL as provenance. Hitting the bound, a fetch failure, or a low-text or image-heavy PDF (needs OCR or a browser) marks coverage incomplete. |
| 3 | Extract | cheap LLM via API | The extractor reads all gathered text when it fits; otherwise every chunk (with headings, overlap, document identity), reconciled across chunks. No passage is dropped before extraction. For each field it returns items with verbatim quotes in the page's language, or `not_found`. Schema-constrained output where the provider supports it; otherwise JSON parsed against the strict schema. |
| 4 | Verify | code | Strict zod schema, quote on its page (`quoteOnPage`), `statesDate` per due date (a numeric date readable two ways is unresolved unless the page's convention is stated), one quote per rule, `co_finance` needs `co_finance_required`, counts and arithmetic. A failure rejects the item, not the programme. |
| 5 | Check | Jev | Each judgment gets typed state: the item, its quote, the surrounding section, and the programme and round facts. Noul P(broken) per item: selection criterion, not a hard rule; rule says more or other than its quote; polarity (No would mean qualifies); due date not that step's deadline. Choice: `kind`, report frequency (compared with the extractor). Omission: for each field returned `not_found` or short, Jev asks per chunk "does this text state a requirement of type X?", and a yes sends that field back for extraction. Ambiguity (spread distribution) escalates like a flag. |
| 6 | Escalate | strong LLM | Flagged or failed items: the strong model (Opus or Sol high) re-reads the field's text with the flag as context and returns a fixed item or `unresolved`. Its output goes through stages 4 and 5 again. |
| 7 | Write | script | A coverage manifest per programme (documents, hashes, round, chunks read, per-field outcome: `stated`, `not_found`, `partial`, `unresolved`) is kept in `data/requirements/`. Verified facts are written surgically. A faulted eligibility rule or document drops alone and leaves its field `partial` (the sound items are written); a faulted step drops the steps. `requirements_checked` is set only when coverage is complete and no field is `partial` or `unresolved`. Otherwise facts are saved but the bars keep "Not checked yet" for the unknown ones. |
| 8 | Land | script | Batches of ~30 programmes per PR; gates: `bun run gate`, `verify-quotes`. Every reading gets a second reader, a model other than the reading's (default `gpt-6.2-sol-high`, chosen by `eval-reviewers.ts` on 2026-11-24): `review.ts brief` → `review.ts run` (the reviewer's verdicts, then apply) (planted canaries, a verdict per item, standards in `docs/review-standards.md`), and `validate` fails a reading from 2026-11-24 on without one. On the 2026-11-23 batch reviewers faulted 26% of written items; `lint.ts` catches about one in twelve of those, so the reader stays until the labels in `tests/fixtures/review-labels/` say otherwise. |

## Calibration (pilot)

1. Gold set: 40 programmes for tuning plus 20 held out, across types (small grant,
   EU call, foundation, PDF-heavy, non-English, portal-only), filled by a strong
   model with page access and checked by a person.
2. Measure on the held-out set: document-discovery recall, omitted requirements,
   false `requirements_checked` stamps, item accuracy, and each Jev threshold's
   precision and recall. Keep the set in `tests/fixtures/requirements/` so it runs as
   a test after any prompt, model or question change.
3. Adjudication, written from the tune set before the held run and applied
   unchanged to it. The raw score pairs one written item with one gold item on
   name or quote; a person (or agent) then reads each unpaired item and rules:
   - Same requirement, other words or a neighbouring sentence of the same passage:
     a hit.
   - One written item that states two gold items from one sentence: two hits only
     if its words name both; otherwise one hit and one miss.
   - A gold item split into two written items: one hit; the second is not an extra.
   - A written item the gold set lacks: a sound extra when its quote states a hard
     requirement of the current round (gold lists at most 8 rules, so it picked
     others); a wrong extra when it is a selection criterion, an older round's
     rule, another programme's, or says more than its quote.
   - A gold item on a document the run never gathered: a discovery miss, counted
     once in discovery recall, not again as an extraction miss.
   Report raw and adjudicated numbers side by side.

## Budgets

Cache by content hash, model and prompt version. Per programme: caps on tokens,
retries and escalations; per run: a spend cap. Hitting a cap or truncating input
means coverage incomplete, never checked. Measure real usage on the pilot before
the full run.

## Facts the finder can match on

A visitor who says a little about their organisation (country, type, years
operating, yearly budget, co-funding they can bring) could see the grants they
can't apply to greyed out. That needs rules a script can test, so stage 3 also
captures, when the page states them: minimum years operating, a revenue or budget
range, and a requested-amount range relative to revenue. These ride on the
eligibility items as optional typed values next to `rule` and `kind`, schema to be
added before the backfill so the pages are read once. A rule without a typed value
stays text and never greys anything out.

## Where agents fit

Claude Code agents build and change the pipeline, make the gold set, and take what
the pipeline can't: pages that need a browser, OCR cases, blocked fetches, and
`unresolved` items. The night-shift job `naturefunding-before-you-apply` does
these, not the bulk reading. The weekly summary issue lists them as leads (a rules
document the text names that wasn't read, an application page on another site, an
unresolved field), open calls first; `bun scripts/requirements/leads.ts` prints all.

## GPT Pro as first reader (tried 2026-11-18, not adopted)

`gpt-pro.ts` + `gpt-pro-browser.sh` have GPT Pro on chatgpt.com read the funder's site, and `run.ts --answers` puts its answer in place of the cheap extractor (our copy still verifies every quote). On the 9 held gold programmes with an answer (CI runs 44245159266 baseline, 44251989245 with answers; `eval.ts --ids`):

| | recall | precision | discovery | stamped |
|---|---|---|---|---|
| current pipeline | 37.3 | 67.2 | 57.9 | 1 |
| GPT Pro first reader | 26.4 | 40.8 | 57.9 | 0 |

Noise floor (the 11 held without an answer, same pipeline in both runs): recall 41.9 both, precision 49.6 vs 45.6. GPT Pro skips requirements the cheap model finds, splits one requirement into short fragment quotes, and makes some calls the page doesn't support (consortium "no" from a list of applicant types). It doesn't add discovery: where our fetcher can't open the site (Cornell, SF Bay), its cited pages can't be verified either. Each answer also takes 20–30 minutes, and the Chrome extension blocks reading back answers whose URLs carry query strings.

## Recall work (2026-11-18/19)

Raw `eval.ts` scores (all items), CI runs on the gold set; adjudication (Calibration §3) not yet done, so precision is understated.

| Run | Change | tune recall / precision | held recall / precision | held discovery |
|---|---|---|---|---|
| base | before | 40.2 / 47.2 (tune2) | 40.0 / 55.1 | 70.8 |
| recall-1 | documents take one quote each, up to 10 | 48.3 / 46.7 | 45.2 / 52.6 | 70.8 |
| recall-2 | + `keptFromFirst`, prompt 18.1 ("decisive" rules), checklist links | 47.9 / 43.4 | 41.9 / 57.1 | 66.7 |
| recall-3 | prompt 19.1 (below) | 45.2 / 44.9 | 43.3 / 58.2 | 72.9 |

- Kept: the documents cap (document recall 26→46 tune, 35→48 held), `keptFromFirst`, checklist links in `RELEVANT`, prompt 19.x. Prompt 19 writes fewer rules (tune 274→237 made, 125→119 paired): fewer wrong rules shown for ~2 points of recall, the trade we want. Differences of 2–3 points are within run-to-run noise on 20–40 programmes.
- Prompt 19 came from the batch-1 review: rules that restate the purpose, applicant types, countries or amount; how-to-apply rules (template, word count, file format); softened limits ("as a rule") written as hard rules; decisions and agreement signing as steps; consortium "no" from a list of who may apply.
- Held was partly seen: recall-2's held misses were read while tuning, so held numbers after recall-1 are optimistic.

Batch 1 (20 programmes, `--queue 20`, ~$2): a cross-family reviewer found errors in ~13% of items; all were fixed by hand before landing (dropped rules, rewritten steps and dates, one consortium fact removed).

Stamps: by raw measure almost every `requirements_checked` the pipeline makes is false (1 of 56 sound). Batches land with `requirements_checked: false` until stamp precision is shown on adjudicated held numbers; facts still show, and absent ones read "Not checked yet".

Weak spots:
- GitHub runner IPs are blocked by some funders (Cornell, SF Bay, WA). Run batches from the Mac (`OPENAI_API_KEY`, `TYPESAFE_API_KEY` in the env) for those.
- `.doc` files are unreadable; offsite application portals aren't followed; transient fetch failures leave "nothing to read" (prairie-state, nwt).
- `statesDate` can't read Japanese era dates (令和9年1月29日), so those dues stay empty.
- The free-text `reporting` field isn't filled from `after_award.reports` (Anglian shows "Reporting: Not found" with a final report stated).

## Cursor route (2026-11-19)

The OpenAI API credits ran out mid-backfill, so batches now run on the Mac through the signed-in Cursor CLI: `--cheap cursor:gpt-5.6-luna-high --strong cursor:gpt-5.6-sol-high --no-jev`. Same models, billed to the Cursor plan (the ledger records $0); `cursor-agent` has no structured outputs, so the schema goes in the prompt and zod checks the answer. CI has no Cursor login, so these runs are local only. Jev is off locally (its key lives only in GitHub secrets), so every item of every batch gets the cross-family fact check.

Held gold set, raw: 46.3 recall / 51.4 precision, discovery 85.4 (recall-3 on OpenAI: 43.3 / 58.2, 72.9). Without Jev ranking links, more pages are read: more facts found, more extras to review.

Prompt 20.1 (2026-11-20), from the batch 2 review (24% of items wrong): either/or routes are one rule; duties after the award, permits the applicant must follow and optional items are not rules; later-stage and optional documents are left out; alternative deadlines or application types are one step, not steps in order; a report the funder "may" require is not a duty. Held, raw, on Cursor: 45.9 recall / 58.8 precision (prompt 19.2: 46.3 / 51.4); document precision 60→76.

## Second reader eval (2026-11-24)

`eval-reviewers.ts` on 9 programmes with gpt-5.6 readings (108 items, a canary in each programme). Two judges (gpt-6.2-sol xhigh, a fresh Opus) settled each of the 32 items any reviewer flagged against the funders' pages: each called 21 wrong; they agree on 14 wrong and 4 sound. Four more items that only Sol medium flagged were judged later (the Opus judge found 1 wrong, which makes 22; both judges agree on 15). A key that needs the Sol judge favours the Sol reviewer, so the Opus judge's key is the fairer one.

| Reviewer (runs) | Errors caught, Opus judge's 22 | Both judges' 15 | Flags the Opus judge calls sound | Cost per 9 programmes | Minutes |
| --- | --- | --- | --- | --- | --- |
| gpt-6.2-sol-high, codex (2) | 15–16 | 13–14 | 7 | ChatGPT plan, 190–204k tokens | 13 |
| gpt-6.2-sol-medium, codex (2) | 14–15 | 12–14 | 2–9 | ChatGPT plan, 144–184k tokens | 6–8 |
| claude-opus-5-5-high, Cursor (3) | 5–7 | 1–3 | 0 | $1.56–2.02 | 5–6 |
| claude-sonnet-5-5-high, Cursor (2 clean) | 4–7 | 1 | 0 | $1.03–1.08 | 5 |
| gemini-4-neon-high, Cursor (1) | 3 | 3 | 0 | $2.13 | 11 |
| gemini-4-neon-medium, Cursor (1) | 0 | 0 | 0 | $0.90 | 5 |

All caught every canary, so canaries prove the reviewer read the items, not that it judges them well. The errors the Claude and Gemini reviewers passed are omitted scope and exemptions (KNCF's Basic categories, CLP's per-member limits, Klimawildnis's 333 ha minimum in its guide); Sol finds them at the price of more flags a judge disputes. What lands matters more than flags: an Opus judge rated Sol's 27 edits to KNCF, Klimawildnis and CLP (`review.ts run`, 3 programmes, 10 min plus two repairs of under a minute) 23 better, 3 neutral, 1 worse (an either/or route split into its own rule). So the second reader is `gpt-6.2-sol-high` and the rule is another model, not another family; gpt-6.2 isn't on Cursor. Fixes that came out of it: a third Sonnet run read the earlier verdicts in `tests/fixtures/review-labels/` (excluded above; the brief now forbids it and the scorer marks it), briefs name the id and the per-field caps that made runs fail apply, and `review.ts run` hands a refusal back to the reviewer for up to two repairs. Evidence: `docs/reviewer-eval/2026-11-24/` (the disputed items, who flagged each, both judges, the judged edits). Medium effort is close to high, but it catches one error fewer on average, its flags vary more (2 to 9 the Opus judge calls sound), and its edits aren't judged yet; it saves about 15% of tokens and half the time. So high stays the default, and medium is the fallback when the ChatGPT plan runs short (`--reviewer gpt-6.2-sol-medium`). One medium run wrote `null` for absent fields; the verdict schema now reads null as absent.
