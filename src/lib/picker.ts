// The home header's pickers: a native <select> becomes a Base UI–style select (a button and a listbox) or,
// with `search`, a combobox (a text field that filters the listbox). The hidden select stays the value: picking
// sets it and fires "change", and a "sync" event on it redraws the picker after the finder sets it.
// Without JavaScript the native select is what shows.

const check =
  '<svg class="size-4 shrink-0 opacity-0 group-aria-selected/o:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
// Restoration Scope's country flags (country-flag-icons 3×2, copied by scripts/images/flags.ts).
const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code)
    ? `<span class="relative inline-block shrink-0 rounded-[2px] after:absolute after:inset-0 after:rounded-[2px] after:ring-1 after:ring-black/10 after:ring-inset"><img class="block h-[13px] w-5 rounded-[2px]" src="/flags/${code}.svg" alt="" loading="lazy" width="20" height="13"></span>`
    : ''
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

let n = 0

// `flagAt` places the chosen country's flag in the field and `flagPad` makes room for it; the defaults suit the
// header's fields, whose text sits 7px under the field's middle (pt-6 against pb-2.5).
export function picker(
  sel: HTMLSelectElement,
  search = false,
  flagAt = 'top-[calc(50%+0.5px)] left-4',
  flagPad = 'pl-[2.75rem]!',
) {
  const seg = sel.parentElement!
  const id = sel.id
  sel.id = `${id}-native`
  sel.hidden = true
  const listId = `${id}-list`

  const trigger = document.createElement(search ? 'input' : 'button') as HTMLInputElement & HTMLButtonElement
  trigger.id = id
  trigger.className = `${sel.className} text-left`
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-controls', listId)
  trigger.setAttribute('aria-expanded', 'false')
  if (search) {
    trigger.setAttribute('type', 'text')
    trigger.autocomplete = 'off'
    trigger.spellcheck = false
    trigger.setAttribute('aria-autocomplete', 'list')
  } else {
    trigger.setAttribute('type', 'button')
    trigger.setAttribute('aria-haspopup', 'listbox')
  }
  const flagBox = document.createElement('span')
  flagBox.className = `pointer-events-none absolute flex ${flagAt}`

  const list = document.createElement('div')
  list.id = listId
  list.setAttribute('role', 'listbox')
  list.hidden = true
  list.className =
    'group/l absolute top-[calc(100%+0.5rem)] left-0 z-20 flex max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain flex-col rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-[0_10px_38px_rgb(0_0_0/0.18)] ' +
    // The country list under its field (full width on phones); a short list beside its field, or on phones a
    // sheet along the bottom, as the When and Who fields are half the width there.
    (search
      ? 'w-[min(22rem,calc(100vw-2rem))] max-md:inset-x-0 max-md:w-auto'
      : 'w-max min-w-full max-w-[22rem] max-md:fixed max-md:inset-x-3 max-md:top-auto max-md:bottom-3 max-md:w-auto max-md:max-w-none max-md:min-w-0 max-md:rounded-2xl max-md:p-2')
  const empty = document.createElement('p')
  empty.className = 'px-2 py-2 text-sm text-muted-foreground'
  empty.textContent = 'No match'
  empty.hidden = true

  const opts: HTMLElement[] = []
  const add = (o: HTMLOptionElement, into: HTMLElement) => {
    if (o.hidden) return
    const el = document.createElement('div')
    el.id = `pk${++n}`
    el.setAttribute('role', 'option')
    el.dataset.value = o.value
    el.className =
      'group/o flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm leading-5 select-none data-active:bg-muted max-md:py-2.5'
    el.innerHTML = `${flag(o.value)}<span class="min-w-0 flex-1 truncate"></span>${check}`
    el.querySelector('.flex-1')!.textContent = o.textContent
    into.append(el)
    opts.push(el)
  }
  for (const c of sel.children) {
    if (c instanceof HTMLOptionElement) add(c, list)
    else if (c instanceof HTMLOptGroupElement) {
      const g = document.createElement('div')
      g.setAttribute('role', 'group')
      g.className = 'group-data-searching/l:contents'
      const h = document.createElement('div')
      h.id = `pk${++n}`
      h.className = 'px-2 pt-2.5 pb-1 text-xs font-medium text-muted-foreground group-data-searching/l:hidden'
      h.textContent = c.label
      g.setAttribute('aria-labelledby', h.id)
      g.append(h)
      for (const o of c.children) add(o as HTMLOptionElement, g)
      list.append(g)
    }
  }
  list.append(empty)
  seg.append(trigger, flagBox, list)
  seg.querySelector('label')?.setAttribute('for', id)

  // In the order they show, so the arrow keys follow the ranked matches.
  const visible = () => opts.filter((o) => !o.hidden).sort((a, b) => +a.style.order - +b.style.order)
  let active: HTMLElement | undefined
  const setActive = (o?: HTMLElement) => {
    active?.removeAttribute('data-active')
    active = o
    if (!o) return trigger.removeAttribute('aria-activedescendant')
    o.setAttribute('data-active', '')
    trigger.setAttribute('aria-activedescendant', o.id)
    o.scrollIntoView({ block: 'nearest' })
  }
  const current = () => opts.find((o) => o.dataset.value === sel.value)

  function render() {
    const o = sel.selectedOptions[0]
    const text = o?.textContent ?? ''
    if (search) {
      trigger.value = sel.value ? text : ''
      trigger.placeholder = sel.options[0]!.textContent!
    } else {
      trigger.textContent = text
      trigger.toggleAttribute('data-empty', !sel.value)
    }
    flagBox.innerHTML = flag(sel.value)
    trigger.classList.toggle(flagPad, !!flagBox.innerHTML)
    for (const x of opts) x.setAttribute('aria-selected', String(x.dataset.value === sel.value))
  }

  // While searching, the groups step aside (display: contents) and the matches line up by how well they
  // match: the name starts with the words, then a word in it does, then it contains them.
  function filter(q: string) {
    const f = fold(q.trim())
    list.toggleAttribute('data-searching', !!f)
    for (const o of opts) {
      const t = fold(o.textContent!)
      const rank = !f ? 0 : t.startsWith(f) ? 1 : t.includes(` ${f}`) ? 2 : t.includes(f) ? 3 : 0
      o.hidden = !!f && (!o.dataset.value || !rank)
      o.style.order = String(rank)
    }
    for (const g of list.querySelectorAll<HTMLElement>('[role=group]')) g.hidden = !g.querySelector('[role=option]:not([hidden])')
    empty.hidden = visible().length > 0
    setActive(visible()[0])
  }

  function open() {
    if (!list.hidden) return
    list.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    if (search) {
      trigger.placeholder = 'Search a country or region'
      filter('')
    }
    setActive(current() ?? visible()[0])
  }
  function close() {
    if (list.hidden) return
    list.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    setActive()
    render()
  }
  function choose(o: HTMLElement) {
    sel.value = o.dataset.value!
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    close()
    if (search) trigger.select()
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : !search && close()))
  trigger.addEventListener('input', () => {
    open()
    filter(trigger.value)
  })
  let typed = ''
  let typedAt = 0
  trigger.addEventListener('keydown', (e) => {
    const v = visible()
    const i = active ? v.indexOf(active) : -1
    const step = (to: number) => {
      e.preventDefault()
      if (list.hidden) return open()
      setActive(v[Math.max(0, Math.min(v.length - 1, to))])
    }
    if (e.key === 'ArrowDown') step(i + 1)
    else if (e.key === 'ArrowUp') step(i - 1)
    else if (e.key === 'PageDown') step(i + 10)
    else if (e.key === 'PageUp') step(i - 10)
    else if ((e.key === 'Home' || e.key === 'End') && !list.hidden && !search) step(e.key === 'Home' ? 0 : v.length - 1)
    else if (e.key === 'Enter' || (e.key === ' ' && !search)) {
      e.preventDefault()
      if (list.hidden) open()
      else if (active) choose(active)
    } else if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') close()
    else if (!search && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      // Typeahead: letters jump to the next option that starts with them.
      typed = Date.now() - typedAt > 600 ? e.key : typed + e.key
      typedAt = Date.now()
      const hit = v.find((o) => fold(o.textContent!).startsWith(fold(typed)))
      if (hit) {
        open()
        setActive(hit)
      }
    }
  })
  // Keep focus in the field while the pointer picks.
  list.addEventListener('mousedown', (e) => e.preventDefault())
  list.addEventListener('click', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('[role=option]')
    if (o) choose(o)
  })
  list.addEventListener('pointermove', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('[role=option]')
    if (o && o !== active) setActive(o)
  })
  seg.addEventListener('focusout', (e) => {
    if (!seg.contains(e.relatedTarget as Node)) close()
  })
  document.addEventListener('pointerdown', (e) => {
    if (!seg.contains(e.target as Node)) close()
  })
  sel.addEventListener('sync', render)
  render()
}
