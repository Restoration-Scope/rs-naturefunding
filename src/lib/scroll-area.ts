// Drives src/components/ui/scroll-area.tsx: sizes and places each thumb from its viewport's scroll, drags it, and
// jumps on a click in the track. Areas may nest, so each finds only its own viewport and bar.
const MIN_THUMB = 18

export function initScrollAreas(root: ParentNode = document) {
  for (const area of root.querySelectorAll<HTMLElement>('[data-slot="scroll-area"]')) {
    const vp = area.querySelector<HTMLElement>(':scope > [data-slot="scroll-area-viewport"]')
    const bar = area.querySelector<HTMLElement>(':scope > [data-slot="scroll-area-scrollbar"]')
    const thumb = bar?.querySelector<HTMLElement>('[data-slot="scroll-area-thumb"]')
    if (!vp || !bar || !thumb) continue

    // The thumb's height and the scroll per pixel of thumb travel, from the last layout.
    let h = 0
    let ratio = 1
    const update = () => {
      const { scrollHeight: sh, clientHeight: ch, scrollTop: st } = vp
      bar.hidden = sh <= ch + 1
      if (bar.hidden) return
      const track = bar.clientHeight - 2
      h = Math.max((track * ch) / sh, MIN_THUMB)
      ratio = (sh - ch) / Math.max(track - h, 1)
      thumb.style.height = `${h}px`
      thumb.style.transform = `translateY(${st / ratio}px)`
    }

    vp.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(vp)
    for (const child of vp.children) ro.observe(child)

    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      thumb.setPointerCapture(e.pointerId)
      const y0 = e.clientY
      const top0 = vp.scrollTop
      const move = (m: PointerEvent) => (vp.scrollTop = top0 + (m.clientY - y0) * ratio)
      const up = () => {
        thumb.removeEventListener('pointermove', move)
        thumb.removeEventListener('pointerup', up)
        thumb.removeEventListener('pointercancel', up)
      }
      thumb.addEventListener('pointermove', move)
      thumb.addEventListener('pointerup', up)
      thumb.addEventListener('pointercancel', up)
    })
    // A click in the track centres the thumb there.
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const y = e.clientY - bar.getBoundingClientRect().top - 1
      vp.scrollTop = (y - h / 2) * ratio
    })

    update()
  }
}
