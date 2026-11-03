# PostHog relay (relay.naturefunding.org)

Passes the site's cookieless PostHog requests to PostHog US (`us.i.posthog.com`, scripts from `us-assets.i.posthog.com`), so blockers that drop third-party analytics hosts still count the visit. It drops cookies, forwards the visitor's IP as `X-Forwarded-For` (PostHog's daily visitor hash needs it; the project discards IPs), and keeps and logs nothing.

The site points `api_host` at it in `src/layouts/Base.astro`. The code never changes with the data, so it isn't in the deploy workflow; deploy it by hand after a change:

```bash
bunx wrangler deploy --config relay/wrangler.jsonc
```
