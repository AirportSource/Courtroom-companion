import { revealParts } from '../engine/unicodeText.ts'

interface TypewriterTextProps {
  text: string
  visibleCount: number
}

/**
 * Renders the revealed part of a line. The unrevealed rest is laid out but invisible, so
 * word wrapping is final from the first character and words never jump between lines.
 */
export function TypewriterText({ text, visibleCount }: TypewriterTextProps) {
  const [visible, hidden] = revealParts(text, visibleCount)
  return (
    <>
      <span>{visible}</span>
      <span className="typewriter-hidden" aria-hidden="true">
        {hidden}
      </span>
    </>
  )
}
