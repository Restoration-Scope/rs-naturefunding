# naturefunding.org

A static Astro site (Bun, TypeScript) on Cloudflare static assets. Data lives as JSON files in `data/`; the site is built from them.

## Mission

Restoration Scope backs the people doing the work on the ground; this site gets their projects funded for the least effort. Operators must choose between doing the work and applying for grants, so we do the finding, rule out grants they can't apply to or that cost more effort than they return, and spell out what applying takes. Writing support comes later, as help, not automated applications. Build the engine, not hand fixes: each lesson becomes a rule, check or prompt that holds for every listing and gives legitimate results at scale. The workflow has four stages (`docs/grant-workflow.html`): **Discovery** fills a backlog of leads; **Gathering** collects everything later stages need from the funder (call pages, documents, the form, FAQs, earlier rounds); **Triage** validates each entry (accept, hold, reject); **Processing** turns the evidence into what an operator needs to decide (rules, effort, fit).

## Rules

- **First-party only.** Every listing comes from the funder's own call page: eligibility, amount, deadline and region each carry `source_url`, a verbatim `quote` and `checked_at`. Directories and competitor guides (fundsforNGOs, Terra Viva, Restor, BIOFIN FIRE, GrantWatch, OpenForests…) are tips for where to look; never copy a row or a value from them.
- **Who we list.** naturefunding.org is for project operators: organisations (and individuals leading field projects) that run restoration or conservation work on the ground. List a programme when an operator can apply as the project lead, whoever pays. Leave out farmer and landowner payment schemes, grants only for students or academic research, and grants open only to public agencies. Equipment grants for field projects stay.
- **Read the call as an applicant.** Record how you apply (online form, PDF or Word form, portal, email), each step and what it asks for. Hunt for hidden criteria beyond the call text: the form's own fields, FAQs, guidance files, earlier rounds, launch posts, who got funded.
- **Never infer.** A deadline or limit the current round's page doesn't state stays empty. A limit stated only for an earlier round, or a guidance document the page names but doesn't link, is a lead to flag to Bernat, never a fact.
- **Static site.** Pages are static: no SSR adapter, and search and filters run in the browser on the built data. Separate small Workers (the MCP server, the email signup) may sit beside the site, but they never render its pages.
- **Neutral.** No paid listings, no ranking by who pays, and the fit of a listing never depends on Restoration Scope. Restoration Scope is named openly as the builder.
- **Triage criteria.** Use `docs/triage-criteria.md` for the written accept/hold/reject checklist and worked examples that turn these rules into scanner decisions.
- **Show UI changes.** After any change a visitor can see, send Bernat a screenshot of it from the dev server before asking to ship; don't wait to be asked.
- **Improvements log.** A change a visitor can see adds one line to `docs/improvements.md` in its PR: `- YYYY-MM-DD · what a visitor sees now · a URL that shows it · #PR`. The naturefunding.org LinkedIn Page drafts its update posts from it.
- Run `bun run check`, `bun run validate`, `bun test` and `bun run build` before committing; there is no CI on PRs.

Astro docs: https://docs.astro.build
