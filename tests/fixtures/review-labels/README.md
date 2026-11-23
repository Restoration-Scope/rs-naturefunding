# Reviewer labels

One line per item a second reader judged, in `review.ts`'s `verdict` shape plus `batch`. These are reviewer verdicts, not gold: a sound item is one no reviewer faulted. `lint.test.ts` scores the code checks against them; `review.ts apply` appends each new review here.

`2026-11-23.jsonl` was labelled after the fact from six hand-run review batches (98 programmes read 2026-11-23), so it bends the later conventions:

- `index` is the position in that run's written list. For `rev-r2a` and `rev-r2b` the run rewrote only some fields, and faults the reviewer found in older items have no record.
- A replaced item shows twice: the old one `wrong` (action `replace`) and the new fact as `missed`. So `missed` overcounts what the extraction left out.
- `co_finance_required` sometimes carries `co_finance` faults, and `after_award` is one record per programme.
