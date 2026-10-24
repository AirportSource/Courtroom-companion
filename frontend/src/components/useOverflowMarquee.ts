import { useEffect, type RefObject } from 'react'

/** Scroll speed in stage pixels per second (constant, so longer labels take longer). */
const SPEED_PX_PER_S = 28
const START_DELAY_MS = 300
const END_PAUSE_MS = 900
const RESTART_PAUSE_MS = 600

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Hidden part of a clipped label, in CSS (stage) pixels. */
function overflowOf(el: HTMLElement): number {
  return Math.max(0, el.scrollWidth - el.clientWidth)
}

/**
 * Horizontal "marquee" for a fixed-width, clipped label. While `active`, if the text
 * overflows its viewport, the viewport's own scroll position is stepped in whole pixels
 * from start to end at constant speed, pauses, jumps back and loops. Only the text moves;
 * the element's box never changes. With reduced motion, the end of the label is shown
 * statically instead. Also keeps a `title` with the full text whenever it overflows.
 */
export function useOverflowMarquee(viewportRef: RefObject<HTMLElement | null>, text: string, active: boolean) {
  // Tooltip + overflow class, kept current across resizes and late font loads.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const overflowing = overflowOf(el) > 0
      el.title = overflowing ? text : ''
      el.classList.toggle('marquee-overflowing', overflowing)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    void document.fonts?.ready.then(update)
    return () => observer.disconnect()
  }, [viewportRef, text])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollLeft = 0
    if (!active) return

    let frame = 0
    let timer = 0
    const reset = () => {
      el.classList.remove('marquee-active')
      el.scrollLeft = 0
    }

    if (prefersReducedMotion()) {
      // No movement: after the usual delay, show the end of the label in one step.
      timer = window.setTimeout(() => {
        if (overflowOf(el) === 0) return
        el.classList.add('marquee-active')
        el.scrollLeft = overflowOf(el)
      }, START_DELAY_MS)
      return () => {
        window.clearTimeout(timer)
        reset()
      }
    }

    const run = () => {
      const distance = overflowOf(el)
      if (distance === 0) return
      el.classList.add('marquee-active')
      const duration = (distance / SPEED_PX_PER_S) * 1000
      const start = performance.now()
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration)
        el.scrollLeft = Math.round(distance * progress) // whole pixels: no blurry offsets
        if (progress < 1) {
          frame = requestAnimationFrame(step)
        } else {
          timer = window.setTimeout(() => {
            el.scrollLeft = 0
            timer = window.setTimeout(run, RESTART_PAUSE_MS)
          }, END_PAUSE_MS)
        }
      }
      frame = requestAnimationFrame(step)
    }
    timer = window.setTimeout(run, START_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      reset()
    }
  }, [viewportRef, text, active])
}
