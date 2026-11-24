# Review standards

standards: 2026-11-24.1

What the second reader checks in every "Before you apply" item an extraction wrote. `bun scripts/requirements/review.ts brief` puts this file in every reviewer brief; change the version line when you change a rule. Field rules: `data/README.md` (eligibility, documents, effort, co_finance, after_award).

## Every cited document

- It is this programme and the current round. A sibling programme's RFP on the same site (`wrong_round_or_programme`), an older round, or a generic third-party page such as a portal tutorial: every item it supports is wrong.

## Eligibility

- Says no more and no other than its quote (`says_more_than_quote`). Yes means the applicant qualifies; a cap on past awards leaves room for this one: "fewer than 3", not "no more than 3" (`polarity`).
- Hard rules only. Drop selection, quality or priority criteria (`selection_criterion`); format, length or template (`how_to_apply_as_rule`); duties after the award, permit or law compliance, optional items (`award_condition_or_duty`).
- Either/or routes are one rule, not several that all seem to apply (`either_or_split`).
- What the grant won't pay for is one rule quoting the list, or none (`cost_exclusion_split`). Activity exclusions (what the project may not be) stay.
- A place, applicant type, amount or theme the listing already holds is no rule (`restates_listing`). Keep a place rule only when it is stricter than `geography`.
- `kind` fits the rule (`kind_wrong`). `request_cap` only when the funder caps a request against one year's revenue or budget.

## Documents

- First-step items only. Not the application form or proposal itself (`document_is_application`), not items asked only at an invited later stage or marked optional (`document_later_or_optional`), no item twice (`duplicate`).

## Effort

- Stages the applicant submits or is reviewed at, in order. Alternative deadlines or application types are not sequential steps; signing, acceptance and anything after the award are not steps (`step_not_a_stage`).
- `due` only when the step's quote states day, month and year together (`due_wrong`).

## Co-funding, consortium, after the award

- `co_finance_required` and `consortium_required` are what the quote states; "encouraged" is not required (`cofinance_wrong`).
- `after_award.reports` matches the stated schedule; "may require" is not required (`reports_wrong`).

## Missed facts

- Read the linked guidelines for a required match, a report schedule, a pre-application step, a hard rule or a first-step document the extraction left out (`missed_hard_rule`, `missed_document`, `missed_step`, `missed_fact`).

## Limits

Rule and document ≤120 characters, step ≤80, at most 8 rules and 10 documents. Each quote ≤400 characters, copied verbatim from a page our quote checker can fetch. Quotes per field: documents as many as there are documents (3 to 10), effort 5, after_award 4; when a field is full, name an existing quote (`quotes`) instead of adding one, or apply refuses the whole review. Items in English; quotes in the funder's language.
