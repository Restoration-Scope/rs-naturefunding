/** Under GitHub's limit of 65,536 characters for an issue body. */
export const MAX_ISSUE_BODY = 65_000

/** The summary as an issue body: cut at a line end when it's too long, with a link to the run that shows it whole. */
export function issueBody(body: string, runUrl: string): string {
  if (body.length <= MAX_ISSUE_BODY) return body
  const note = `\n\nCut to fit an issue. The whole summary: ${runUrl}`
  const kept = body.slice(0, MAX_ISSUE_BODY - note.length)
  return kept.slice(0, kept.lastIndexOf('\n')) + note
}
