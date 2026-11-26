// Filters and sorting on /fiscal-sponsors/: which sponsors show, in what order, kept in the address. Without it every sponsor is listed by name.
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
  const unplaced = document.querySelector<HTMLElement>('[data-unplaced]')!
  const whereSel = form.querySelector<HTMLSelectElement>('select[name="where"]')!
  const picked = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`[name="${name}"]:checked`)].map((i) => i.value)

  // "-" in front reverses it. Sponsors that don't say stay last either way, and ties keep the names in order.
  let sort = ''
  const answers = ['abroad', 'companies', 'individuals']
  const value = (r: HTMLElement, key: string): number[] | null => {
    if (key === 'name') return [rows.indexOf(r)]
    if (key === 'charges') return r.dataset.rate ? r.dataset.rate.split(' ').map(Number) : null
    const a = r.dataset.answers!.split(',')[answers.indexOf(key)]
    return a ? [Number(a)] : null
  }
  const order = (list: HTMLElement[]) => {
    const key = sort.replace('-', '')
    const sign = key === sort ? 1 : -1
    return list.sort((x, y) => {
      const [a, b] = [value(x, key), value(y, key)]
      // A charge with no rate ("No cost to join") still says more than nothing.
      if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1) || said(y, key) - said(x, key)
      return sign * (a[0] - b[0] || (a[1] ?? 0) - (b[1] ?? 0))
    })
  }
  const said = (r: HTMLElement, key: string) => (key === 'charges' && !r.querySelector('[data-label="Charges"][data-none]') ? 1 : 0)
  const keys = [...document.querySelectorAll<HTMLElement>('[data-col]')]
  const select = document.querySelector<HTMLSelectElement>('[data-sort-select]')!
  const setSort = (to: string) => {
    sort = to
    select.value = to
    for (const th of keys) {
      if (th.dataset.col === to.replace('-', '')) th.setAttribute('aria-sort', to[0] === '-' ? 'descending' : 'ascending')
      else th.removeAttribute('aria-sort')
    }
  }

  const update = () => {
    const projects = picked('project')
    const takes = picked('takes')
    const fits = (r: HTMLElement) => projects.length === 0 || words(r, 'sp').some((t) => projects.includes(t))
    const wider = (r: HTMLElement) =>
      !fits(r) && (words(r, 'sp').some((t) => general.includes(t)) || words(r, 'broader').some((t) => projects.includes(t)))
    const says = (r: HTMLElement) => takes.every((t) => words(r, 'yes').includes(t))
    // data-where spells out each country a sponsor's regions hold (whereReach). A sponsor whose pages name no place goes last, under its own heading; one whose place leaves the project out is hidden.
    const where = whereSel.value
    const place = (r: HTMLElement) => (!where ? 'all' : r.dataset.where === undefined ? 'unsaid' : words(r, 'where').some((c) => c === '*' || c === where || c === `R:${where.slice(2)}`) ? 'all' : 'out')
    const listed = (r: HTMLElement) => says(r) && place(r) === 'all'
    const first = order(rows.filter((r) => fits(r) && listed(r)))
    const second = order(rows.filter((r) => wider(r) && listed(r)))
    const third = order(rows.filter((r) => (fits(r) || wider(r)) && says(r) && place(r) === 'unsaid'))
    for (const r of rows) r.hidden = !first.includes(r) && !second.includes(r) && !third.includes(r)
    divider.hidden = second.length === 0
    unplaced.hidden = third.length === 0
    const last = rows[0].parentElement!
    last.append(...first, divider, ...second, unplaced, ...third)
    const parts = [second.length && `${second.length} broader`, third.length && `${third.length} don’t say where`].filter(Boolean)
    shown.textContent = parts.length ? `${first.length} shown, ${parts.join(', ')}` : `${first.length} of ${rows.length} shown`
    clear.hidden = projects.length + takes.length === 0 && !where
    // A sponsor that doesn't say is hidden, not refused: say how many.
    const silent = rows.filter((r) => (fits(r) || wider(r)) && !says(r) && place(r) != 'out' && takes.every((t) => words(r, 'yes').includes(t) || !words(r, 'said').includes(t))).length
    const out = where ? rows.filter((r) => (fits(r) || wider(r)) && says(r) && place(r) === 'out').length : 0
    const name = whereSel.selectedOptions[0]?.text ?? ''
    unsaid.textContent = [silent ? `${silent} more don’t say.` : '', out ? `${out} ${out === 1 ? 'rules' : 'rule'} out ${name}.` : ''].filter(Boolean).join(' ')
    unsaid.hidden = !unsaid.textContent
    return new URLSearchParams([...(where ? [['where', where]] : []), ...projects.map((v) => ['project', v]), ...takes.map((v) => ['takes', v]), ...(sort === 'name' ? [] : [['sort', sort]])])
  }

  const q = new URLSearchParams(location.search)
  for (const i of form.querySelectorAll<HTMLInputElement>('input')) i.checked = q.getAll(i.name).includes(i.value)
  whereSel.value = q.get('where') ?? ''
  if (whereSel.selectedIndex < 0) whereSel.value = ''
  const asked = q.get('sort') ?? ''
  setSort(keys.some((th) => th.dataset.col === asked.replace('-', '')) ? asked : 'name')
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
  select.addEventListener('change', () => setSort(select.value))
  form.addEventListener('change', change)
  for (const b of document.querySelectorAll<HTMLElement>('[data-sort]'))
    b.addEventListener('click', () => {
      setSort(sort === b.dataset.sort ? `-${sort}` : b.dataset.sort!)
      change()
    })
  // Clearing the filters keeps the order.
  form.addEventListener('reset', () => setTimeout(() => {
    setSort(sort)
    change()
  }))
  update()

  const target = location.hash && document.getElementById(location.hash.slice(1))
  const toggle = target && target.querySelector<HTMLDetailsElement>('[data-sp-toggle]')
  if (toggle) toggle.open = true
}
