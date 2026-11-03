import type { Listing } from './data'

/** The apply box's button: the call page while a call is open or coming, else where to look next. */
export function primaryAction(
  { p, state, call }: Listing,
  openChildren: Listing[],
  childCount: number,
): { href: string; text: string; quiet?: boolean } {
  return call && (state === 'open' || state === 'rolling' || state === 'upcoming')
    ? { href: call.url, text: 'Go to the funder’s call page' }
    : call?.recurring && state === 'none'
      ? { href: call.url, text: 'Check the call page' }
      : openChildren.length === 1
        ? { href: `/p/${openChildren[0]!.p.id}/`, text: 'See the open partner programme' }
        : openChildren.length > 1
          ? { href: '#partners-title', text: `See the ${openChildren.length} open partner programmes` }
          : p.access === 'intermediary' && childCount > 0
            ? { href: '#partners-title', text: `See the ${childCount} partner programmes` }
            : p.access === 'intermediary'
              ? { href: p.evidence.access?.source_url ?? p.url, text: 'Find a partner on the funder’s site' }
              : { href: p.url, text: 'Read the funder’s page', quiet: true }
}

/** The fact the apply box dates: the call, or how to apply. */
export const applyEvidenceFor = ({ p, call }: Listing) =>
  (call && (call.evidence.deadline ?? call.evidence.recurring ?? call.evidence.status)) ?? p.evidence.access ?? null
