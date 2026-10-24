import { useEffect, useState, type RefObject } from 'react'

/**
 * Largest scale at which a stage of `width`×`height` logical pixels fits its container.
 * Integer scales keep pixel art crisp; below 1× a fractional scale is used so the stage
 * still fits.
 */
export function useStageScale(
  containerRef: RefObject<HTMLElement | null>,
  width: number,
  height: number,
): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => {
      const fit = Math.min(container.clientWidth / width, container.clientHeight / height)
      setScale(fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.25))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, width, height])

  return scale
}
