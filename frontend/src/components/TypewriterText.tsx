interface TypewriterTextProps {
  text: string
  visibleCount: number
}

/**
 * Renders the revealed part of a line. The unrevealed rest is laid out but invisible, so
 * word wrapping is final from the first character and words never jump between lines.
 */
export function TypewriterText({ text, visibleCount }: TypewriterTextProps) {
  return (
    <>
      <span>{text.slice(0, visibleCount)}</span>
      <span className="typewriter-hidden" aria-hidden="true">
        {text.slice(visibleCount)}
      </span>
    </>
  )
}
