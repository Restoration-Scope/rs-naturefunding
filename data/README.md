# naturefunding.org data

Every listing on naturefunding.org is a JSON file in this folder. The contract is the zod schema in [`src/data/schema.ts`](../src/data/schema.ts); the site build and the scripts below refuse any file that breaks it. Data is licensed as described in [`LICENSE.md`](LICENSE.md).

## Files

- `programmes/<id>.json`: one funding programme per file. The file name is the programme's `id`.
- `sources.json`: the watch list. Every page a fact cites, which the daily refresh job re-reads.

## A programme

| Field | Meaning |
|---|---|
| `id` | Lowercase kebab-case, equal to the file name. |
| `name`, `funder` | The programme and the organisation whose money it is. |
| `administered_by` | Who runs the call for the funder, e.g. the national host of a GEF Small Grants country programme or a CEPF Regional Implementation Team. `null` when the funder runs it. |
| `parent` | The umbrella programme, e.g. `gef-sgp` for `gef-sgp-india`. One level only. |
| `url` | The funder's main page for the programme. |
| `summary` | One or two sentences in our own words. Never copied. |
| `approaches` | What kind of nature work it funds (reforestation, mangroves, species conservation…). Our classification. |
| `applicant_types` | Who may apply (NGO, community group, Indigenous organisation, individual…). |
| `geography` | `global`; `countries` with ISO 3166-1 codes; or `regions` when the funder names a group ("ODA-eligible countries") without listing countries. In `regions`, `label` is the funder's wording and `regions` is our mapping for filters. |
| `access` | How an applicant reaches the money: `direct` (apply to an open call), `intermediary` (through a country programme, accredited entity or partner), `invitation_only` (the funder picks), or `unspecified`. |
| `window` | `fixed` (rounds with deadlines), `rolling` (apply any time), or `unspecified`. |
| `amount` | Grant size in the funder's currency, `min` and/or `max` as stated. `typical: true` when the funder gives a usual range ("typically", "generally") rather than limits. |
| `co_finance_required` | Whether matching funds are required. |
| `reporting` | What grantees must report, in our words. Filled only where the funder states it. |
| `calls` | Rounds of applications (below). |
| `evidence` | One evidence record per stated fact above. |
| `checked_at` | The oldest evidence date: every fact was read against the funder's pages on or after this day. |

**`null` means the funder's pages don't say**, never "no restriction". A missing amount is unknown, not unlimited.

## A call

A call is one round of applications: `id` (unique within the programme), `label`, `url`, `status`, `opens`, `deadline` (date, optional time and time zone, and the deadline as the funder wrote it), and evidence for status, opens and deadline.

| Status | Meaning |
|---|---|
| `open` | The funder's page says applications are being accepted. |
| `upcoming` | Announced, not open yet. |
| `closed` | The round has ended. |
| `suspended` | The funder paused it. |
| `unknown` | The page exists but its state can't be read. |

Each status is as of the day in its evidence. A call is never `open` with a deadline before that day: a round whose stated deadline has passed is `closed`, even if the page still says open. A date's quote must contain its year; a window the funder states without a year ("October 15 to December 22") keeps `opens` and `deadline` null and goes in the label.

### The four shapes

- **Rolling** (e.g. Rufford Small Grants): `window: rolling`, one standing call with status `open` and no deadline.
- **Fixed rounds** (e.g. Darwin Initiative): `window: fixed`, one call per round with its stated deadline.
- **Invitation only** (e.g. Bezos Earth Fund): `access: invitation_only`, no calls.
- **Intermediary** (e.g. GEF Small Grants Programme): the umbrella has `access: intermediary` and no calls; each country programme is its own file with `parent`, `administered_by` and its own calls.

## How a fact is checked

Each stated fact carries an evidence record:

```json
{ "source_url": "https://apply.ruffordsmallgrants.org", "quote": "Grants range from £7,000 to £18,000.", "checked_at": "2026-11-01", "method": "page" }
```

1. **First-party only.** `source_url` is the funder's own page, or the official implementer's (a UNDP country office, a CEPF Regional Implementation Team). Directories and guides only tell us where to look; no value is taken from them.
2. **Verbatim quote.** `quote` is copied from the page. `bun run verify-quotes` fetches every cited page, turns it into plain text, folds case, quote marks, dashes and spaces, and checks every quote appears on it. Any miss fails the run.
3. **Never inferred.** A deadline or opening date the page doesn't state stays `null`.
4. **Re-read daily.** The refresh job re-reads every page in `sources.json`. An unchanged page moves `checked_at` forward; a changed fact opens a pull request for review.

We keep only quotes, links and dates. Funder pages themselves are not committed.

## Scripts

| Command | What it does |
|---|---|
| `bun run validate` | Schema, file name = id, unique ids, parents exist, every cited page is on the watch list. |
| `bun run verify-quotes` | Fetches every cited page (cached for the day in `.cache/`) and checks every quote. `--fresh` refetches; pass ids to check only some programmes. |
| `bun run sync-sources` | Adds a watch-list entry for every newly cited page and picks a main-text selector; keeps hand-written selectors and hints. |
| `bun scripts/data/page-text.ts <url> [--grep word]` | Prints a page exactly as the quote checker sees it. Copy quotes from here. |

## Adding a programme

1. Read the funder's pages with `page-text.ts`.
2. Write `programmes/<id>.json`, quoting each fact you state and leaving the rest `null`.
3. Run `bun run sync-sources`, `bun run validate` and `bun run verify-quotes`.
