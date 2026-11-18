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
| 8 | Land | script | Batches of ~30 programmes per PR; gates: `validate`, `verify-quotes`, `bun test`, `build`. Auto-merge only after the pilot proves the rates below; until then a fact reviewer from another model family checks every batch. Afterwards a 5% random sample, plus deliberate samples of empty results and non-English pages. |

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
these, not the bulk reading.

## GPT Pro as first reader (tried 2026-11-18, not adopted)

`gpt-pro.ts` + `gpt-pro-browser.sh` have GPT Pro on chatgpt.com read the funder's site, and `run.ts --answers` puts its answer in place of the cheap extractor (our copy still verifies every quote). On the 9 held gold programmes with an answer (CI runs 44245159266 baseline, 44251989245 with answers; `eval.ts --ids`):

| | recall | precision | discovery | stamped |
|---|---|---|---|---|
| current pipeline | 37.3 | 67.2 | 57.9 | 1 |
| GPT Pro first reader | 26.4 | 40.8 | 57.9 | 0 |

Noise floor (the 11 held without an answer, same pipeline in both runs): recall 41.9 both, precision 49.6 vs 45.6. GPT Pro skips requirements the cheap model finds, splits one requirement into short fragment quotes, and makes some calls the page doesn't support (consortium "no" from a list of applicant types). It doesn't add discovery: where our fetcher can't open the site (Cornell, SF Bay), its cited pages can't be verified either. Each answer also takes 20–30 minutes, and the Chrome extension blocks reading back answers whose URLs carry query strings.
