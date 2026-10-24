import { TypewriterText } from './TypewriterText.tsx'

interface DialogueBoxProps {
  speakerName: string | null
  text: string
  visibleCount: number
  showContinue: boolean
}

/**
 * Classic DS-style dialogue box, laid out in stage pixels: name plate attached above the
 * left edge of a full-width box along the bottom of the screen.
 * The frame, plate and continue arrow are CSS stand-ins until the original UI graphics are
 * available (see docs/ASSET_SOURCES.md); text is always live text, never baked into images.
 */
export function DialogueBox({ speakerName, text, visibleCount, showContinue }: DialogueBoxProps) {
  return (
    <div className="dialogue" aria-live="polite">
      {speakerName && <div className="dialogue-nameplate">{speakerName}</div>}
      <div className="dialogue-box">
        <p className="dialogue-text">
          <TypewriterText text={text} visibleCount={visibleCount} />
        </p>
        {showContinue && <div className="dialogue-continue" aria-label="Continue" />}
      </div>
    </div>
  )
}
