// The past issues on the site (/digest/ and /digest/<date>/): one per week, for someone who picked no country or
// project type. A week runs Monday 08:00 UTC to the next, when the daily run sends. The first issue is the first
// Monday a full week after the first change, and takes everything before it (launch was a day after the seed).

const WEEK = 7 * 86_400_000

/** Each finished week up to `now`, newest first: `date` is the Monday it ends on, `since` is '' for the first. */
export function issueWeeks(firstEvent: string, now: string): { date: string; since: string; until: string }[] {
  const first = new Date(Date.parse(firstEvent) + WEEK)
  const daysToMonday = (8 - first.getUTCDay()) % 7
  let end = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + daysToMonday, 8)
  if (end <= first.getTime()) end += WEEK
  const weeks: { date: string; since: string; until: string }[] = []
  for (; end <= Date.parse(now); end += WEEK) {
    const until = new Date(end).toISOString()
    weeks.push({ date: until.slice(0, 10), since: weeks.length ? new Date(end - WEEK).toISOString() : '', until })
  }
  return weeks.reverse()
}
