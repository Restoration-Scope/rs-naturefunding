// The weekly-email prompt (src/components/SubscribePrompt.astro): a dialog that opens once a reader is halfway down
// a page, like Substack's. It asks at most once a month, never after a sign-up, and never while someone is typing or
// already looking at a sign-up form. Choices live in localStorage, per browser; without it the prompt stays shut.

const KEY = 'nf-weekly-email-prompt'
export const QUIET_DAYS = 30
const DAY = 86_400_000
/** How far down (share of the scrollable height) and how long on the page before it opens. */
export const DEPTH = 0.5
export const MIN_MS = 6_000

type Stored = { subscribed?: true; dismissedAt?: number }

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

/** Whether the stored choices allow asking today. */
export const mayAsk = (s: Stored | null, now: number) =>
  s !== null && !s.subscribed && !(s.dismissedAt && now - s.dismissedAt < QUIET_DAYS * DAY)

const markSubscribed = () => write({ subscribed: true })

const typing = () => document.activeElement?.matches('input, textarea, select, [contenteditable]') ?? false

/** A sign-up form already on screen (the finder's, the digest pages'), outside the dialog. */
const formInView = (dialog: HTMLDialogElement) =>
  [...document.querySelectorAll<HTMLElement>('[data-digest-form]')].some((f) => {
    if (dialog.contains(f)) return false
    const r = f.getBoundingClientRect()
    return r.bottom > 0 && r.top < innerHeight && r.height > 0
  })

export function initSubscribePrompt() {
  // Confirmed from the email, perhaps in another browser than the one that signed up.
  if (location.pathname === '/digest/subscribed/') markSubscribed()
  // A sign-up from any form on the site counts, so the prompt never asks again.
  document.addEventListener('submit', (e) => {
    if ((e.target as Element).matches?.('[data-digest-form]')) markSubscribed()
  })
  const dialog = document.querySelector<HTMLDialogElement>('[data-subscribe-prompt]')
  if (!dialog || !mayAsk(read(), Date.now())) return

  const start = performance.now()
  let done = false
  const check = () => {
    if (done || document.querySelector('dialog[open]')) return
    const scrollable = document.documentElement.scrollHeight - innerHeight
    // Short pages have nothing to scroll past: they never ask.
    if (scrollable < innerHeight * 0.75) return
    if (scrollY / scrollable < DEPTH || performance.now() - start < MIN_MS) return
    if (typing() || formInView(dialog)) return
    done = true
    removeEventListener('scroll', onScroll)
    dialog.showModal()
  }
  // Cheap until the reader is past the depth and time: only then does it measure forms.
  const onScroll = () => check()
  addEventListener('scroll', onScroll, { passive: true })

  // Closing it any way (the ×, Escape, a click outside) keeps it quiet for a month.
  dialog.addEventListener('close', () => {
    if (!read()?.subscribed) write({ dismissedAt: Date.now() })
  })
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close()
  })
}
