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
  } catch {}
}

/** Whether the stored choices allow the prompt now. */
export const mayAsk = (s: Stored | null, now: number) => s !== null && !s.subscribed && !(s.next && s.next > now)

const rest = (ms: number) => {
  if (!read()?.subscribed) write({ next: Date.now() + ms })
}

export function initSubscribePrompt() {
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
  // Pages under one and a half screens have nothing to scroll past.
  if (!card || !shade || !mayAsk(read(), Date.now()) || root.scrollHeight <= 1.5 * innerHeight) return

  card.hidden = false
  const y = () => Math.max(root.scrollTop, 0)
  // Where the card pins: the middle of the screen.
  let target = (innerHeight - card.offsetHeight) / 2
  let fixed = false
  // The card's top in the page while it moves with it; it starts just below the fold.
  let offset = innerHeight + Math.max(target, MIN_DROP)
  let last = y()
  let seen = false

  const draw = () => {
    card.style.position = fixed ? 'fixed' : 'absolute'
    card.style.top = `${fixed ? target : offset}px`
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
      offset = last + target
    } else if (d < 0 && !fixed && now < offset - vh) {
      // Gone below the fold: wait there again, just under the bottom edge.
      offset = vh + Math.max(target, MIN_DROP, last)
    }
    last = now
    if (!seen && (fixed || (d > 0 && now > offset - vh))) {
      seen = true
      rest(SEEN_REST)
    }
    draw()
  }
  const onResize = () => {
    target = (innerHeight - card.offsetHeight) / 2
    onScroll()
  }

  const close = () => {
    card.hidden = true
    shade.hidden = true
    removeEventListener('scroll', onScroll)
    removeEventListener('resize', onResize)
    removeEventListener('keydown', onKey)
    rest(CLOSED_REST)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && seen) close()
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
