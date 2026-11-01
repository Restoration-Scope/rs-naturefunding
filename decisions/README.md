# Decisions

Calls agents made without waiting, one file each, for a person to approve,
reject or comment on. Managed by the `decision-inbox` skill, which owns the
schema.

- Inbox: `bun ~/.agents/skills/decision-inbox/scripts/inbox.ts serve` from the
  repo root. `todo` lists what came back to agents.
- `status`: `open` (waiting on a person), `approved`, `rejected` (an agent
  undoes it, then `reverted`), `changes` (an agent reworks it, then `open`).
- `media/`: screenshots and short videos the items embed.
