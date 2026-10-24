import { useEffect, useState, type RefObject } from 'react'
import type { StageScaling } from '../settings/settings.ts'

/**
 * Scale for a stage of `width`×`height` logical pixels in a container of the given size.
 * 'pixel': the largest whole factor that fits, so pixel art stays crisp. 'fit': the largest
 * factor that fits, fractional, so the stage fills the space. Below 1× both use a fractional
 * scale (never under 0.25) so the stage still fits.
 */
export function stageScaleFor(
  containerWidth: number,
  containerHeight: number,
  width: number,
  height: number,
  mode: StageScaling,
): number {
  const fit = Math.min(containerWidth / width, containerHeight / height)
  if (fit < 1) return Math.max(fit, 0.25)
  // 'fit' keeps the frame on whole CSS pixels horizontally.
  return mode === 'pixel' ? Math.floor(fit) : Math.floor(fit * width) / width
}

/** Live stage scale for `containerRef`, updated on resize. */
export function useStageScale(
  containerRef: RefObject<HTMLElement | null>,
  width: number,
  height: number,
  mode: StageScaling = 'pixel',
): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => setScale(stageScaleFor(container.clientWidth, container.clientHeight, width, height, mode))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, width, height, mode])

  return scale
}
