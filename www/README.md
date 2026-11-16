# www redirect (www.naturefunding.org)

Sends every `www.naturefunding.org` request to the same path and query on `https://naturefunding.org` with a 301, so Google, AI answers and links see one address per page. `http://` to `https://` is the zone's Always Use HTTPS setting (on since 2026-11-16).

A Worker because the site's custom domains are served by Workers, where zone Page Rules don't apply, and the Cloudflare tokens can't edit redirect rules. The code never changes with the data, so it isn't in the deploy workflow; deploy it by hand after a change:

```bash
bunx wrangler deploy --config www/wrangler.jsonc
```
