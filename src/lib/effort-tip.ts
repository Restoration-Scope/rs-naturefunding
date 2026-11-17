/**
 * The finder's effort bars (EffortBars.astro) and their one shared tooltip (EffortTip.astro). A row carries its
 * levels in data-effort and its reasons in data-why; hovering or focusing it fills the tooltip and places it
 * above the bars. Shared, because a tooltip per row would triple the size of a thousand-row page.
 */
export type Level = 'light' | 'some' | 'heavy' | 'unstated' | 'unchecked'
export const effortLabels = ['Who qualifies', 'Applying', 'Co-funding', 'After the award']
export const effortWords: Record<Level, string> = {
  light: 'light',
  some: 'some work',
  heavy: 'heavy',
  unstated: 'not stated',
  unchecked: 'not checked yet',
}
/** One letter per level: a row's bars carry it as their class (finder.css) and in data-effort. */
export const effortCode: Record<Level, string> = { light: 'l', some: 's', heavy: 'h', unstated: 'u', unchecked: 'c' }
const byCode = Object.fromEntries(Object.entries(effortCode).map(([l, c]) => [c, l])) as Record<string, Level>
// Grey for the unknowns: a dashed outline where the funder's pages are silent, a pale fill where we haven't read them yet.
export const effortFill: Record<Level, string> = {
  light: 'bg-(--ok-dot)',
  some: 'bg-(--caution-dot)',
  heavy: 'bg-(--stop-dot)',
  unstated: 'border border-dashed border-rule-strong',
  unchecked: 'bg-rule',
}

// On the dark tooltip the unknowns need lighter greys.
const tipFill: Record<Level, string> = { ...effortFill, unstated: 'border border-dashed border-background/60', unchecked: 'bg-ink-2' }

export function initEffortTip() {
  const tip = document.querySelector<HTMLElement>('[data-effort-tip]')
  if (!tip) return
  const rows = [...tip.querySelectorAll<HTMLElement>('[data-tip-row]')]
  // The pointer and keyboard focus each own an anchor; the tooltip follows the pointer's, else focus's. A pointer
  // resting on the tooltip keeps what it shows; Escape keeps it closed until the pointer leaves that anchor.
  let hovered: HTMLElement | null = null
  let focused: HTMLElement | null = null
  let shown: HTMLElement | null = null
  let overTip = false
  let dismissed: HTMLElement | null = null
  let leaving = 0
  const place = (bars: HTMLElement) => {
    const r = bars.getBoundingClientRect()
    if (r.bottom < 0 || r.top > innerHeight) return void (tip.hidden = true)
    if (bars !== shown) {
      const levels = [...bars.dataset.effort!].map((c) => byCode[c]!)
      const why = bars.dataset.why!.split('|')
      rows.forEach((row, i) => {
        const bar = row.firstElementChild as HTMLElement
        bar.className = `${bar.dataset.base} ${tipFill[levels[i]!]}`
        row.querySelector('[data-tip-why]')!.textContent = why[i]!
      })
      tip.querySelector<HTMLElement>('[data-tip-unchecked]')!.hidden = !levels.includes('unchecked')
      shown = bars
    }
    tip.hidden = false
    tip.style.left = `${Math.max(8, Math.min(r.left - 8, document.documentElement.clientWidth - tip.offsetWidth - 8))}px`
    tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`
  }
  const update = () => {
    const anchor = hovered ?? (overTip && !tip.hidden ? shown : null) ?? focused
    if (anchor) place(anchor)
    else tip.hidden = true
  }
  const barsOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-effort]') : null)
  // The pointer may cross the gap onto the tooltip to read it (it stays while hovered), so leaving waits a moment.
  document.addEventListener('mouseover', (e) => {
    const bars = barsOf(e.target)
    if (tip.contains(e.target as Node)) {
      clearTimeout(leaving)
      overTip = true
    }
    if (bars && bars !== dismissed) {
      clearTimeout(leaving)
      hovered = bars
      update()
    }
  })
  document.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget as Node | null
    const fromBars = barsOf(e.target)
    if (fromBars === dismissed && !(to && dismissed?.contains(to))) dismissed = null
    const from = fromBars ?? (tip.contains(e.target as Node) ? tip : null)
    if (!from || (to && (from.contains(to) || tip.contains(to) || barsOf(to) === hovered))) return
    if (from === tip) overTip = false
    clearTimeout(leaving)
    leaving = window.setTimeout(() => {
      hovered = null
      update()
    }, 150)
  })
  document.addEventListener('focusin', (e) => {
    focused = barsOf(e.target)
    dismissed = null
    update()
  })
  document.addEventListener('focusout', (e) => {
    if (barsOf(e.target) === focused) focused = null
    update()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || tip.hidden) return
    dismissed = hovered ?? shown
    hovered = focused = null
    overTip = false
    tip.hidden = true
  })
  addEventListener(
    'scroll',
    () => {
      hovered = null
      overTip = false
      update()
    },
    { passive: true },
  )
}
