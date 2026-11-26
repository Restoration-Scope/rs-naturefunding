# Directory listings (Claude, ChatGPT)

Drafts for the submissions, once mcp.naturefunding.org is live. Bernat approves the text and submits nothing until he
says so. Requirements as read from the vendors' docs on 2026-11-26:

- **Claude** (portal claude.ai/directory/manage, any paid plan): no sign-in is fine for public data; every tool needs a
  `title` and `readOnlyHint`; privacy policy, documentation and support contact; 3+ example prompts. An automatic scan
  lists it as Community. https://claude.com/docs/connectors/building/submission
- **ChatGPT** (platform.openai.com/plugins; not approved yet): verified organisation, privacy policy, terms of service
  (naturefunding.org has none yet), support URL, demo video, 5 positive and 3 negative test cases, domain token at
  `/.well-known/openai-apps-challenge` on mcp.naturefunding.org.
  https://developers.openai.com/apps-sdk/deploy/submission

## Listing

- **Name:** naturefunding.org
- **Server URL:** `https://mcp.naturefunding.org` (Streamable HTTP, no sign-in)
- **One-liner (≤200):** Find grants for nature restoration and conservation projects, with each funder's own words and the date we checked them.
- **Description (≤2,000):** naturefunding.org is a free, neutral directory of over 1,000 grants and funding programmes for organisations that lead nature restoration and conservation projects: reforestation, mangroves, wetlands, coasts, species, protected areas and more. Ask for the grants that fit a project, by the country where the work happens, the approach and who applies. Claude sees which calls are open now, upcoming or open every year, with the deadline and amount, then reads the programmes that fit in full: eligibility rules, how to apply and what applying asks for. Every fact comes from the funder's own page, with a verbatim quote and the date it was read, so answers can show their source instead of guessing. Built and paid for openly by Restoration Scope; funders can't pay to be listed or ranked. Data CC BY 4.0.
- **Categories:** Research; Data (pick the closest of the portal's list)
- **Slug (permanent):** `naturefunding`
- **Tools:** `search_grants`, `get_grant`; both read-only, no side effects.
- **Privacy policy:** https://naturefunding.org/privacy/#ai-assistants
- **Documentation:** https://github.com/Restoration-Scope/rs-naturefunding/tree/main/mcp
- **Website:** https://naturefunding.org/
- **Support contact:** contact@naturefunding.org (forwards to Bernat)
- **Icon:** `public/favicon.svg`
- **Company:** Restoration Scope
- **Data handling:** no sign-in; the server receives the tools' arguments (search words, a country or region, an approach, an applicant type, a programme id) and the client app's name and version; nothing is stored and request logs are off.

## Example prompts (Claude use cases; ChatGPT positive tests)

1. "We're a small community NGO in Kenya restoring 40 hectares of mangroves near Mombasa and need about USD 50,000 over two years. Which grants fit?" → `search_grants` with `country: KE` (applicant type `ngo`), then `get_grant` on the best few; CFHF, IKI Small Grants and Marine Conservation Action Fund among them, with deadlines, rules met and failed, and naturefunding.org links.
2. "Somos una ONG en Colombia que restaura bosque seco. ¿Qué convocatorias hay abiertas?" → `search_grants` with `country: CO`, `status: open`; the answer in Spanish.
3. "Is the Rufford Small Grants programme open, and how much can we ask for?" → `search_grants` with query `rufford`, then `get_grant`; status, amount and the funder's quote with the checked date.
4. "Grants for community groups working on coral reefs in Indonesia that open in the next few months." → `search_grants` with `country: ID`, approach `coastal_marine`.
5. "Show me more." after a search → `search_grants` again with `offset`.

Negative (the assistant should not call the tools):

1. "How do I write a logframe for a reforestation project?"
2. "What's the carbon price for nature-based credits this year?"
3. "Translate this grant report into French."

## Demo video (ChatGPT only)

About 60 seconds: add the connector, ask example 1, open one naturefunding.org link from the answer and show the
funder's quote and checked date on the page.
