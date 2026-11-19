// The weekly-email prompt (src/components/SubscribePrompt.astro), a copy of Substack's post subscribe prompt. The
// card is not opened at a threshold: it sits in the page below the fold and moves with the scroll. Scrolling down
// carries it up to the middle of the screen, where it pins; scrolling up lets go of it, and it slides away with
// the page. A black shade darkens with it, from nothing to 60% as the card rises. Choices live in localStorage,
// per browser; without it the prompt stays away.

const KEY = 'nf-weekly-email-prompt'
const HOUR = 3_600_000
/** Once seen, it rests for an hour; once closed, a day (Substack's own timings). */
export const SEEN_REST = HOUR
export const CLOSED_REST = 24 * HOUR
/** The card starts at least this far below the top of the screen. */
const MIN_DROP = 600
const MAX_SHADE = 0.6

type Stored = { subscribed?: true; next?: number }

const read = (): Stored | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored
  } catch {
    return null
  }
}
const write = (s: Stored) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}

/** Whether the stored choices allow the prompt now. */
export const mayAsk = (s: Stored | null, now: number) => s !== null && !s.subscribed && !(s.next && s.next > now)

const rest = (ms: number) => {
  if (!read()?.subscribed) write({ next: Date.now() + ms })
}

// The weekly email's Where follows the page's own: the finder's Where (its header field, on / and the place
// pages) or a programme page's ?where=. A form whose Where the reader picked keeps their pick.
function followWhere() {
  const own = 'select[name=where]'
  const forms = () => [...document.querySelectorAll<HTMLSelectElement>(`[data-digest-form] ${own}`)]
  const pageWhere = () =>
    document.querySelector<HTMLSelectElement>(`[data-ask] ${own}`)?.value ?? new URLSearchParams(location.search).get('where') ?? ''
  const apply = () => {
    const w = pageWhere()
    for (const s of forms())
      if (!('picked' in s.dataset) && s.value !== w && [...s.options].some((o) => o.value === w)) {
        s.value = w
        s.dispatchEvent(new Event('sync'))
      }
  }
  const later = (e: Event) => {
    if ((e.target as Element).closest?.('[data-digest-form]')) {
      if (e.type === 'change') (e.target as HTMLElement).dataset.picked = ''
    } else setTimeout(apply)
  }
  // The finder redraws its fields with a "sync" event, which doesn't bubble: listen while it comes down.
  for (const type of ['change', 'sync', 'click']) document.addEventListener(type, later, true)
  addEventListener('popstate', apply)
  apply()
}

export function initSubscribePrompt() {
  followWhere()
  const markSubscribed = () => write({ subscribed: true })
  // Confirmed from the email, perhaps in another browser than the one that signed up.
  if (location.pathname === '/digest/subscribed/') markSubscribed()
  // A sign-up from any form on the site counts, so the prompt never comes back.
  document.addEventListener('submit', (e) => {
    if ((e.target as Element).matches?.('[data-digest-form]')) markSubscribed()
  })

  const card = document.querySelector<HTMLElement>('[data-subscribe-prompt]')
  const shade = document.querySelector<HTMLElement>('[data-subscribe-shade]')
  const root = document.documentElement
  const stored = read()
  // Without a note that sticks, a closed card would come back on every page.
  if (!card || !shade || !mayAsk(stored, Date.now()) || !write(stored!)) return

  const room = root.scrollHeight - innerHeight
  const y = () => Math.max(root.scrollTop, 0)
  // Out of reach of the keyboard until it shows.
  card.inert = true
  card.hidden = false
  // Where the card pins: the middle of the screen.
  let target = (innerHeight - card.offsetHeight) / 2
  let fixed = false
  let last = y()
  // The card's top in the page while it moves with it; it starts just below the fold, also when the page opens
  // part way down.
  let offset = innerHeight + Math.max(target, MIN_DROP, last)
  let seen = false
  let closed = false
  // Only on a page long enough for the card to reach the middle, and a screen tall enough to hold it.
  if (room < offset - target || target < 8) {
    card.hidden = true
    return
  }

  const draw = () => {
    if (closed) return
    card.style.position = fixed ? 'fixed' : 'absolute'
    card.style.top = `${fixed ? target : offset}px`
    // The pinned card can't scroll, so the country list stops above the bottom of the screen.
    const list = card.querySelector<HTMLElement>('[role=listbox]')
    if (list)
      list.style.maxHeight = fixed
        ? `min(22rem, 60dvh, ${Math.max(innerHeight - card.querySelector('[role=combobox]')!.getBoundingClientRect().bottom - 16, 0)}px)`
        : ''
    const rise = (last - offset + innerHeight) / (innerHeight - target)
    const shading = fixed ? MAX_SHADE : Math.min(Math.max(rise * MAX_SHADE, 0), MAX_SHADE)
    shade.hidden = shading <= 0
    shade.style.opacity = String(shading)
  }

  const onScroll = () => {
    const now = y()
    const d = now - last
    const vh = innerHeight
    if (d > 0 && !fixed && now > offset - target) fixed = true
    else if (d < 0 && fixed) {
      // Let go where it is, so it slides down with the page.
      fixed = false
      offset = now + target
    } else if (d < 0 && !fixed && now < offset - vh) {
      // Gone below the fold: wait there again, just under the bottom edge.
      offset = vh + Math.max(target, MIN_DROP, now)
    }
    last = now
    if (!seen && (fixed || (d > 0 && now > offset - vh))) {
      seen = true
      card.inert = false
      rest(SEEN_REST)
      // The country field searches with flags, as the finder's does (whose script already made it so on /).
      const where = card.querySelector<HTMLSelectElement>('select[data-flags]')
      if (where && !where.hidden)
        import('./picker').then(({ picker }) => {
          picker(where, true, 'top-1/2 left-[0.65rem] -translate-y-1/2', 'pl-[2.4rem]!')
          draw()
        })
    }
    draw()
  }
  const onResize = () => {
    target = Math.max((innerHeight - card.offsetHeight) / 2, 8)
    onScroll()
  }

  const close = () => {
    closed = true
    card.hidden = true
    shade.hidden = true
    removeEventListener('scroll', onScroll)
    removeEventListener('resize', onResize)
    removeEventListener('keydown', onKey)
    rest(CLOSED_REST)
  }
  const onKey = (e: KeyboardEvent) => {
    // Escape in the country list closes only the list.
    if (e.key === 'Escape' && seen && !e.defaultPrevented) close()
  }

  addEventListener('scroll', onScroll, { passive: true })
  addEventListener('resize', onResize)
  addEventListener('keydown', onKey)
  card.querySelector('[data-subscribe-close]')?.addEventListener('click', close)
  // A click on the shade closes the card only once its top is within 300px of the top of the screen.
  shade.addEventListener('click', () => {
    if (y() >= offset - 300) close()
  })
  draw()
}
