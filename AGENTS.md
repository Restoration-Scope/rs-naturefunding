# naturefunding.org

A static Astro site (Bun, TypeScript) on Cloudflare static assets. Data lives as JSON files in `data/`; the site is built from them.

## Rules

- **First-party only.** Every listing comes from the funder's own call page: eligibility, amount, deadline and region each carry `source_url`, a verbatim `quote` and `checked_at`. Directories and competitor guides (fundsforNGOs, Terra Viva, Restor, BIOFIN FIRE, GrantWatch, OpenForests…) are tips for where to look; never copy a row or a value from them.
- **Never infer a deadline.** If the page doesn't state it, the field stays empty.
- **No server for visitors.** No Worker script, no SSR adapter, no API routes; search and filters run in the browser on the built data.
- **Neutral.** No paid listings, no ranking by who pays, and the fit of a listing never depends on Restoration Scope. Restoration Scope is named openly as the builder.
- Run `bun run check` and `bun run build` before committing.

Astro docs: https://docs.astro.build
