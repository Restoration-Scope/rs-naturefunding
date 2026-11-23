# naturefunding.org verification feature map

Each feature is a capability an operator or maintainer relies on, with the harness that proves it. Pick the
smallest feature that covers the claim and follow its file.

| Feature | Claim it proves | Proof |
| --- | --- | --- |
| [requirements-reading](requirements-reading.md) | "Before you apply" items come from the funder's current pages, each with a verbatim quote | `run.ts` + Doctor + `validate` + `verify-quotes` |
| [second-reader](second-reader.md) | Every written item had a verdict from another model family, and the reader was tested | `review.ts brief/apply`, canaries, the validate gate |
| [quote-freshness](quote-freshness.md) | Facts already listed still match their funder pages | `verify-quotes`, refresh run, leads |
| [programme-page](programme-page.md) | A programme page shows the reviewed items and says when a fact is unknown | dev server + browser |

## Baseline preconditions

- The checkout and SHA under review are recorded.
- `bun scripts/requirements/doctor.ts` passes (the Doctor for every data feature).
- `bun run validate` passes, or you know which problems you are fixing.

## Proof and skip reporting

- Name the feature IDs exercised and the programme ids they ran on.
- Report models as the CLI reported them, Jev on or off, cost from `report.json`.
- Report canaries planted and caught, and items wrong and missed per batch.
- Say which boundaries you did not exercise and why.
