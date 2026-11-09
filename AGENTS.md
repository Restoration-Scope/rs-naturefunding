# naturefunding.org

A static Astro site (Bun, TypeScript) on Cloudflare static assets. Data lives as JSON files in `data/`; the site is built from them.

## Rules

- **First-party only.** Every listing comes from the funder's own call page: eligibility, amount, deadline and region each carry `source_url`, a verbatim `quote` and `checked_at`. Directories and competitor guides (fundsforNGOs, Terra Viva, Restor, BIOFIN FIRE, GrantWatch, OpenForests…) are tips for where to look; never copy a row or a value from them.
- **Who we list.** naturefunding.org is for project operators: organisations (and individuals leading field projects) that run restoration or conservation work on the ground. List a programme when an operator can apply as the project lead, whoever pays. Leave out farmer and landowner payment schemes, grants only for students or academic research, and grants open only to public agencies. Equipment grants for field projects stay.
- **Never infer a deadline.** If the page doesn't state it, the field stays empty.
- **Static site.** Pages are static: no SSR adapter, and search and filters run in the browser on the built data. Separate small Workers (the MCP server, the email signup) may sit beside the site, but they never render its pages.
- **Neutral.** No paid listings, no ranking by who pays, and the fit of a listing never depends on Restoration Scope. Restoration Scope is named openly as the builder.
- **Triage criteria.** Use `docs/triage-criteria.md` for the written accept/hold/reject checklist and worked examples that turn these rules into scanner decisions.
- Run `bun run check`, `bun run validate`, `bun test` and `bun run build` before committing; there is no CI on PRs.

Astro docs: https://docs.astro.build
