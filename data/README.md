# naturefunding.org data

Every listing on naturefunding.org is a JSON file in this folder. The contract is the zod schema in [`src/data/schema.ts`](../src/data/schema.ts); the site build and the scripts below refuse any file that breaks it. Data is licensed as described in [`LICENSE.md`](LICENSE.md).

## Files

- `programmes/<id>.json`: one funding programme per file. The file name is the programme's `id`.
- `sponsors/<id>.json`: one fiscal sponsor per file, for `/fiscal-sponsors/` ([`src/data/sponsors.ts`](../src/data/sponsors.ts): what qualifies, and each field; `types` groups the page). Every value sits beside its quote, and `validate` refuses a quote that makes a neighbouring claim or a value that drops its limit; `bun run verify-sponsors` re-reads them. Not on the watch list, so a file not checked for 90 days drops off the page.
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
| `kind` | `partnership` when the funder pays for work under contract (e.g. planting partners) rather than giving grants. Missing means a grant. Our classification. |
| `approaches` | What kind of nature work it funds (reforestation, mangroves, species conservation…). Our classification. |
| `applicant_types` | Who may apply (NGO, community group, Indigenous organisation, individual…). |
| `geography` | `global`; `countries` with ISO 3166-1 codes; or `regions` when the funder names a group ("Mediterranean basin") nobody lists. A closed set is always `countries`: the ones the funder names, or an official list it points to (`list`, in `data/lists`); `parts` gives the part of a country it takes, and `evidence.places` quotes where they are named. In `regions`, `label` is the funder's wording and `regions` is our mapping for filters; each region is `whole` (every country, so its page says yes) or reached by `areas`, the widest place the label can mean (its countries show as "check", the rest not at all); `named` lists countries the funder names outright beside its group, so they are covered; `except` lists countries it leaves out. `bun run validate` enforces this (`src/data/geography.ts`). |
| `access` | How an applicant reaches the money: `direct` (apply to an open call), `intermediary` (through a country programme, accredited entity or partner), `invitation_only` (the funder picks), or `unspecified`. |
| `window` | `fixed` (rounds with deadlines), `rolling` (apply any time), or `unspecified`. |
| `amount` | Grant size in the funder's currency, `min` and/or `max` as stated. `typical: true` when the funder gives a usual range ("typically", "generally") rather than limits; `max_exclusive: true` when it says "less than"; `per: "year"` for an annual amount; `note` for any other qualifier in the same quote, in our words ("Up to £20,000 in total"). |
| `co_finance_required` | Whether matching funds are required. |
| `fiscal_sponsor` | What the funder says about applying through a fiscal sponsor, fiscal agent or auspice: `stance` `accepted`, `refused` or `discouraged` (it warns against it, or says it doesn't make up for another bar), and `note`, the condition the same quote states. Missing when the funder doesn't mention it; an application document that names one proves it only when it says an applicant may use one. |
| `reporting` | What grantees must report, in our words. Filled only where the funder states it. |
| `effort` | What applying takes, for `direct` programmes: `steps` in order, in our words (at most 5, 80 characters each: "Concept note", "Full proposal, if invited"). A step is a stage the applicant submits or is reviewed at; creating an account, filling the form and pressing submit are one step, not three. `more_after: true` when the page says further steps follow. `due`, one entry per step, the date each step is due in the current or next round (`null` for an undated one), only when one effort quote states that date with its day and year together; leave `due` out when no step is dated, and replace it when a new round's dates are published. Up to 5 quotes in `evidence.effort`. |
| `eligibility` | Each item is `{ rule, kind }`. `rule`: the rules that rule an applicant out, in our words, each phrased as a requirement the applicant meets, so Yes means it qualifies and No rules it out ("Operating for at least 3 years by the deadline", "Not a government body"; never "Registered as a government body"). Hard requirements only: not selection criteria or priorities. One rule per requirement the funder states separately; keep a requirement the funder states in one sentence as one rule. At most 8, most decisive first; include a place or organisation rule only when it is stricter than `geography` and `applicant_types` say. `evidence.eligibility` holds one quote per rule, in the same order. `kind` is our tag: `legal` (status, registration, independence, not a government body), `track_record` (years operating, past projects), `finances` (a financial bar to meet: a revenue or turnover range, audited accounts, a request capped by revenue; ordinary accounts to submit go in `documents`), `capacity` (staff, systems, policies), `project` (the project's scope, size, place or partners), `other`. A required consortium goes in `consortium_required`, not here. Typed values, only when the rule states them, so a script can test an organisation against them: `min_years` on a `track_record` rule (the fewest years operating; 36 months is 3); `revenue` `{ currency, min?, max?, basis, average_years? }` on a `finances` rule (the yearly `revenue`, `budget` or `expenditure` range, averaged over `average_years` when the funder says so); `request_cap` `{ share, of }` on a `finances` rule (the largest request in percent of yearly `revenue` or `budget`: 100 is one year's revenue). The rule's own quote must state each number and the currency; a rule without a typed value stays text and never rules anyone out by itself. |
| `co_finance` | Only when `co_finance_required` is `true` and the page says how much: `min_share`, the smallest share of the project the applicant brings, from its own or third-party funds, in percent, decimals allowed (a 1:1 match is 50); `ratio` ("1:2", applicant to funder) when the funder states the match as a ratio, instead of a share; `min_amount` `{ value, currency }` when the funder states a fixed sum; `in_kind: true` when staff time, land or equipment count toward it; `applies_to` (80 characters) when the requirement covers only some applicants or projects ("Non-Indigenous applicants"). |
| `after_award` | What a grantee must do after the award, each key only when the page states it: `reports`, by the most frequent required report (`final`: one report at the end; `interim_and_final`: one or two interim reports and a final; `yearly`; `twice_yearly`: every six months; `quarterly`: quarterly or more often; `other`: a stated schedule none of these fit, such as at set milestones; `unspecified`: reports required, how often not stated), `audit: true` (an external or independent audit), `site_visits: true`, `training: true` (required training, a capacity programme or events). Up to 4 quotes. Keep the free-text `reporting` too. |
| `requirements_checked` | The day you read the funder's pages, and the guidelines or call document they link, for `eligibility`, `documents`, `effort`, `co_finance` and `after_award`, set whether or not you found any. Set it only when you could read them all; if a page or PDF won't open, leave it out. Without it an absent fact reads "Not checked yet"; with it, "The funder's pages don't say". |
| `documents` | What the funder asks applicants to submit at the first step, in our words, one item per type of document ("Registration certificate", "Audited accounts for the last 2 years" is one item). Not the application form itself. At most 10, with up to 3 quotes, or one per document when the list is spread over the page. |
| `calls` | Rounds of applications (below). |
| `evidence` | One evidence record per stated fact above. |
| `checked_at` | The oldest evidence date: every fact was read against the funder's pages on or after this day. |

**`null` means the funder's pages don't say**, never "no restriction". A missing amount is unknown, not unlimited.

Text is capped so no field can carry a whole page: names, labels and deadline text 200 characters, `summary` 400, `reporting` 600, quotes 400; ids 80, URLs 500, time zones 64; at most 250 countries and 20 calls.

## A call

A call is one round of applications: `id` (unique within the programme), `label`, `url`, `status`, `opens`, `deadline` (date, optional time and time zone, and the deadline as the funder wrote it), and evidence for status, opens and deadline. Optional:

- `expected`: when the funder expects an upcoming call to open, as it says it ("June 2027", "mid-March 2027"), or a date it doesn't confirm. It must name a year its status quote states. Firm dates go in `opens`.
- `recurring`: dates the funder gives without a year, repeating each year, in our words, with `evidence.recurring`.
- `note`: a condition on the call from one of its quotes, in our words ("Subject to funding approval").

| Status | Meaning |
|---|---|
| `open` | The funder's page says applications are being accepted. |
| `upcoming` | Announced, not open yet. |
| `closed` | The round has ended. |
| `suspended` | The funder paused it. |
| `unknown` | The page exists but its state can't be read. |

Each status is as of the day in its evidence (the UTC day it was read). A call is never `open` once its deadline had passed as that day began, in the funder's time zone when it states one: a round whose stated deadline has passed is `closed`, even if the page still says open. A date's quote must contain its year, as four digits or a form that can only be a year ("Nov '26", "04/01/27"), never a bare "26" or a quoted "'26 November'"; a window the funder states without a year ("October 15 to December 22") keeps `opens` and `deadline` null and goes in `recurring`. Such a call is `open` only if the page says applications are being accepted now; otherwise its status is `unknown`, since a yearless window never expires.

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
2. **Verbatim quote.** `quote` is copied from the page, with at least 8 characters besides spaces. `bun run verify-quotes` fetches every cited page for `method: "page"` and `method: "api"` evidence, turns it into plain text, folds case, quote marks, dashes and spaces, and checks every quote appears on it. Any miss fails the run. When a funder blocks the checker but a person reads the page in a browser, use `method: "human"` with the live page as `source_url`; the verifier reports and skips those quotes.
3. **Never inferred.** A deadline or opening date the page doesn't state stays `null`.
4. **Re-read daily.** The refresh job re-reads every page in `sources.json`. An unchanged page moves `checked_at` forward; a changed fact opens a pull request for review.

We keep only quotes, links and dates. Funder pages themselves are not committed.

## Finding new funders

Discovery only raises leads; a person (or an agent following this file) adds a programme from the funder's own page. Each lead goes into one GitHub issue labelled `discovery`, and `data/checks/discovered.json` remembers what was raised so it comes up once.

- **Daily, two APIs** (`scripts/refresh/discover.ts`): open or forecast nature calls in EU Funding & Tenders (`EU_SEARCH_API_KEY`) and grants.gov.
- **Weekly, web search** (`scripts/refresh/discover-web.ts`): 22 Exa searches by region, theme and language (`EXA_API_KEY`, about $0.50 a run). One row per funder site not yet cited in `data/`; directories and news sites are dropped, and on government or platform sites (gov.uk, canada.ca, Submittable…) each page counts on its own.

`--no-issue` on either prints the leads without filing an issue or recording them.

## Scripts

| Command | What it does |
|---|---|
| `bun run validate` | Schema, file name = id, unique ids, parents exist, every cited page is on the watch list. |
| `bun run verify-quotes` | Fetches every cited page (cached for the day in `.cache/`) and checks every quote. `--fresh` refetches; pass ids to check only some programmes. |
| `bun run verify-sponsors` | Reads every page a fiscal sponsor's file cites with the refresh job's polite fetcher and checks its quotes; pass ids to check only some. |
| `bun run sync-sources` | Adds a watch-list entry for every newly cited page and picks a main-text selector; keeps hand-written selectors and hints. |
| `bun test` | Unit tests for the schema rules and quote matching, plus a check of the seeded data. |
| `bun scripts/data/page-text.ts <url> [--grep word]` | Prints a page exactly as the quote checker sees it. Copy quotes from here. |

## Adding a programme

1. Read the funder's pages with `page-text.ts`.
2. Write `programmes/<id>.json`, quoting each fact you state and leaving the rest `null`.
3. Run `bun run sync-sources`, `bun run validate` and `bun run verify-quotes`.
