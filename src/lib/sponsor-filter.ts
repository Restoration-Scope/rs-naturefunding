// The filters on /fiscal-sponsors/: which sponsors show, kept in the address. Without it every sponsor is listed.
const words = (el: HTMLElement, key: string) => (el.dataset[key] ?? '').split(' ').filter(Boolean)
// Sponsors of these types name no single subject, so they follow the ones that name the reader's.
const general = ['environment', 'any']

export function initSponsors() {
  const form = document.querySelector<HTMLFormElement>('[data-filters]')!
  const divider = document.querySelector<HTMLElement>('[data-divider]')!
  const shown = document.querySelector<HTMLElement>('[data-shown]')!
  const clear = document.querySelector<HTMLElement>('[data-clear]')!
  const unsaid = document.querySelector<HTMLElement>('[data-unsaid]')!
  const fold = document.querySelector<HTMLDetailsElement>('[data-fold]')!
  const rows = [...document.querySelectorAll<HTMLElement>('[data-sp]')]
  const picked = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`[name="${name}"]:checked`)].map((i) => i.value)

  const update = () => {
    const projects = picked('project')
    const takes = picked('takes')
    const fits = (r: HTMLElement) => projects.length === 0 || words(r, 'sp').some((t) => projects.includes(t))
    const wider = (r: HTMLElement) =>
      !fits(r) && (words(r, 'sp').some((t) => general.includes(t)) || words(r, 'broader').some((t) => projects.includes(t)))
    const says = (r: HTMLElement) => takes.every((t) => words(r, 'yes').includes(t))
    const first = rows.filter((r) => fits(r) && says(r))
    const second = rows.filter((r) => wider(r) && says(r))
    for (const r of rows) r.hidden = !first.includes(r) && !second.includes(r)
    divider.hidden = second.length === 0
    const last = rows[0].parentElement!
    last.append(...first, divider, ...second)
    shown.textContent = second.length ? `${first.length} shown, ${second.length} broader` : `${first.length} of ${rows.length} shown`
    clear.hidden = projects.length + takes.length === 0
    // A sponsor that doesn't say is hidden, not refused: say how many.
    const silent = rows.filter((r) => (fits(r) || wider(r)) && !says(r) && takes.every((t) => words(r, 'yes').includes(t) || !words(r, 'said').includes(t))).length
    unsaid.hidden = silent === 0
    unsaid.textContent = `${silent} more don’t say.`
    return new URLSearchParams([...projects.map((v) => ['project', v]), ...takes.map((v) => ['takes', v])])
  }

  const q = new URLSearchParams(location.search)
  for (const i of form.querySelectorAll<HTMLInputElement>('input')) i.checked = q.getAll(i.name).includes(i.value)
  // Beside the table the filters stay open; above it they fold.
  const beside = matchMedia('(min-width: 68rem)')
  const place = () => (fold.open = beside.matches)
  beside.addEventListener('change', place)
  place()
  form.hidden = false
  const change = () => {
    const picks = update()
    history.replaceState(null, '', `${location.pathname}${picks.size ? `?${picks}` : ''}`)
  }
  form.addEventListener('change', change)
  form.addEventListener('reset', () => setTimeout(change))
  update()

  const target = location.hash && document.getElementById(location.hash.slice(1))
  const toggle = target && target.querySelector<HTMLDetailsElement>('[data-sp-toggle]')
  if (toggle) toggle.open = true
}
