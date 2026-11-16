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
  const show = (e: Event) => {
    const bars = (e.target as Element).closest<HTMLElement>('[data-effort]')
    if (!bars) return
    const levels = [...bars.dataset.effort!].map((c) => byCode[c]!)
    const why = bars.dataset.why!.split('|')
    rows.forEach((row, i) => {
      const bar = row.firstElementChild as HTMLElement
      bar.className = `${bar.dataset.base} ${tipFill[levels[i]!]}`
      row.querySelector('[data-tip-why]')!.textContent = why[i]!
    })
    tip.querySelector<HTMLElement>('[data-tip-unchecked]')!.hidden = !levels.includes('unchecked')
    tip.hidden = false
    const r = bars.getBoundingClientRect()
    const w = tip.offsetWidth
    tip.style.left = `${Math.max(8, Math.min(r.left - 8, document.documentElement.clientWidth - w - 8))}px`
    tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`
  }
  const hide = (e: Event) => {
    const from = (e.target as Element).closest('[data-effort]')
    if (from && !from.contains((e as MouseEvent).relatedTarget as Node | null)) tip.hidden = true
  }
  document.addEventListener('mouseover', show)
  document.addEventListener('focusin', show)
  document.addEventListener('mouseout', hide)
  document.addEventListener('focusout', hide)
  addEventListener('scroll', () => (tip.hidden = true), { passive: true })
}
