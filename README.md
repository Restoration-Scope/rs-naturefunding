# naturefunding.org

A free directory of grants and funding for nature restoration and conservation projects. Every listing is read from the funder's own page, with the exact words it was taken from and the date it was checked.

Built and maintained by [Restoration Scope](https://restorationscope.com). Listings are never paid for, and the data is open.

## How listings are checked

- Each fact (deadline, amount, eligibility, region) carries the source page, a verbatim quote from it, and the date it was checked.
- Directories and other funding lists only tell us where to look. We never copy a listing from them.
- A daily job re-reads each funder page. Unchanged pages get a new checked date; changed pages open a pull request that is reviewed against the saved page before it goes live.
- Spot something wrong? [Open an issue](https://github.com/Restoration-Scope/rs-naturefunding/issues/new).

## Licences

- Data (`data/`): [CC BY 4.0](data/LICENSE.md). Quotes from funder pages stay their authors'; we keep them short and link the source.
- Code: [MIT](LICENSE).

## Develop

```bash
bun install
bun run dev
```

`bun run deploy` builds the static site and uploads it to Cloudflare (static assets, no Worker script).
