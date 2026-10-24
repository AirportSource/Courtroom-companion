import { useRef } from 'react'
import { useOverflowMarquee } from './useOverflowMarquee.ts'

interface OverflowMarqueeProps {
  text: string
  /** Scroll the label while true (the selected / hovered / focused option). */
  active: boolean
}

/**
 * A label clipped to its container's width (ellipsis at rest) that scrolls horizontally
 * inside its own viewport while active, if it overflows. The full text always stays in
 * the DOM and accessibility tree.
 */
export function OverflowMarquee({ text, active }: OverflowMarqueeProps) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  useOverflowMarquee(viewportRef, text, active)
  return (
    <span className="marquee" ref={viewportRef}>
      {text}
    </span>
  )
}
