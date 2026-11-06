/** Marks the contents link of the section being read: the last one whose top has passed a third of the window.
    The first link (Overview, the top of the page) is marked until another section gets there. */
export function initPageContents() {
  const nav = document.querySelector<HTMLElement>('[data-contents]')
  if (!nav) return
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
  const targets = links.map((a) => (a.hash ? document.getElementById(decodeURIComponent(a.hash.slice(1))) : null))
  let frame = 0
  const mark = () => {
    frame = 0
    const line = window.innerHeight / 3
    let current = 0
    targets.forEach((t, i) => {
      if (t && t.getBoundingClientRect().top <= line) current = i
    })
    // At the very bottom, the last sections may never reach the line: the one just jumped to wins, if in view.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      const jumped = links.findIndex((a) => a.hash && a.hash === location.hash)
      const top = jumped >= 0 ? targets[jumped]?.getBoundingClientRect().top : undefined
      current = top !== undefined && top >= 0 && top < window.innerHeight ? jumped : targets.length - 1
    }
    links.forEach((a, i) => {
      a.toggleAttribute('data-active', i === current)
      if (i === current) a.setAttribute('aria-current', 'location')
      else a.removeAttribute('aria-current')
    })
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(mark)
  }
  // A jump glides like pele.run's contents: 0.15 ms a pixel, between 100 and 300 ms, easing out. Reduced motion jumps.
  let glide = 0
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  nav.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    const t = a.hash ? document.getElementById(decodeURIComponent(a.hash.slice(1))) : null
    const from = scrollY
    const to = t ? Math.max(0, from + t.getBoundingClientRect().top - (parseFloat(getComputedStyle(t).scrollMarginTop) || 0)) : 0
    history.pushState(null, '', a.hash || location.pathname + location.search)
    cancelAnimationFrame(glide)
    if (still.matches) return scrollTo({ top: to, behavior: 'instant' })
    const ms = Math.min(300, Math.max(100, Math.abs(to - from) * 0.15))
    let start: number | undefined
    const step = (now: number) => {
      start ??= now
      const k = Math.min((now - start) / ms, 1)
      scrollTo({ top: from + (to - from) * k * (2 - k), behavior: 'instant' })
      glide = k < 1 ? requestAnimationFrame(step) : 0
    }
    glide = requestAnimationFrame(step)
    schedule()
  })
  addEventListener('scroll', schedule, { passive: true })
  addEventListener('resize', schedule)
  addEventListener('hashchange', schedule)
  addEventListener('popstate', schedule)
  mark()
}
