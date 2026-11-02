---
version: 1
slug: "src-pages-index-astro"
primary_target: "src/pages/index.astro"
related_targets: ["src/pages/p","src/pages/about.astro"]
---

# Finder and listing pages (naturefunding.org)

Scope: the finder (home), programme pages /p/<id>/, and /about/. Visitor mode: Operate on the finder; Read on programme and about pages.

Audience and job: restoration NGO staff and project developers looking for money they can apply for; they filter by status, place, approach, applicant type and access route, and need to trust the deadline. Proof: every fact's source quote and checked date. Constraints: static, no server, no accounts, WCAG AA, phone width, light theme only.

Chosen direction: Restoration Scope's own look, chosen by Bernat on 2026-11-01 over the earlier "Plot kit" field-kit direction (Atkinson Hyperlegible, aluminium ground, flagging-tape labels), which is retired. Built with shadcn components rendered at build time; light theme only.

## Direction contract

THESIS: A listing is only as good as its provenance. Every fact shows the funder's own words, a source link and the date we checked it. Refuses the category default of a card grid with a green "Open" pill and no date.

OWN-WORLD: Restoration Scope's palette: beige paper ground, dark green-black ink, brand green for actions and links, a deep brand-green header band (on the home page, the forest image shown whole in a rounded frame, never faded). Geist Serif for page and section headings; Inter for everything else, including programme and call names in lists. Hairline rules, small radii, no shadows except the raised filter sheet and the home header's question card.

STORY: The visitor reads one honest sentence, filters to what they can apply for, sees the deadline in the funder's words and a "Checked" date, opens the programme page and reads each fact with its quote and source link.

FIRST VIEWPORT: A large header band: the one-sentence purpose, a white card with two questions (Where is your project? What kind of project?) that set the Where and Approach filters, and a "Show N programmes" button; the forest image beside it on wide screens, a low band above it on phones. Below, quick status buttons with counts; on desktop, a filter sidebar with every group open (search, status, deadline, where, approach, applicant, access, size) beside a dense, sortable table: status badge, programme with the funder's mark, deadline as a date plus the funder's wording, amount, checked date. Tablet: filters open as a side panel. Phone: one "Filters" button opens a bottom sheet; table rows become stacked rows. Rows that are not open now sit below a divider, behind "Show N not open now".

FORM: Status is a small badge with a coloured dot (Open green, Rolling blue, Upcoming terracotta, Closed grey, No call found muted). Funders and administrators carry their own favicon mark, or a monogram, beside their names. The checked date is a quiet tag after each source; past the aging limit it adds an amber "due a recheck" note. Programme pages: a facts table (label, our summary, the funder's quote, source and checked date), calls as folding cards sorted by deadline, a status card with the apply button.

CONSTRAINTS: static, no accounts; only the home page loads script; 44px touch targets on coarse pointers; WCAG AA; works from 320px.
