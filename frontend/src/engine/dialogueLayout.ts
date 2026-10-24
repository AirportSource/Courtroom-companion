// Logical geometry of the DS dialogue text area and the text measurer used by the paginator.
// All values are logical stage pixels: display scale (1×/3×/auto) never affects pagination.
// DialogueBox applies these same constants, so layout and pagination cannot drift apart.

/** Box 256 wide, 1px border each side, 6px horizontal padding → 242px of text width. */
export const DIALOGUE_TEXT = {
  width: 242,
  paddingX: 6,
  paddingTop: 1,
  lineHeight: 15,
  maxLines: 3,
  /** Room kept free at the end of the last line for the continue arrow (6px + gap). */
  continueReserve: 8,
  /** Safety margin against sub-pixel differences between canvas and DOM text layout. */
  safety: 1,
} as const

/** Interior height: exactly maxLines × lineHeight + top padding (46px). */
export const DIALOGUE_TEXT_HEIGHT = DIALOGUE_TEXT.maxLines * DIALOGUE_TEXT.lineHeight + DIALOGUE_TEXT.paddingTop

/** Measures a single line of text in logical px. */
export type MeasureText = (text: string) => number

export interface TextLayout {
  measure: MeasureText
  /** Usable width of each line of one page (length = max lines per page). */
  lineWidths: number[]
  /** BCP 47 locale for sentence/word segmentation (e.g. "en", "fr", "ja"). */
  locale?: string
}

export function dialogueLineWidths(): number[] {
  const { width, maxLines, continueReserve, safety } = DIALOGUE_TEXT
  return Array.from({ length: maxLines }, (_, i) => width - safety - (i === maxLines - 1 ? continueReserve : 0))
}

/**
 * Fixed-advance measurer used for tests and as a conservative fallback when canvas
 * measurement isn't available. The defaults cover Igiari's widest encoded advance at 16px;
 * browser pagination normally uses the real canvas metrics instead.
 */
export function gridMeasure(charWidth = 18, spaceWidth = 8): MeasureText {
  return (text) => [...text].reduce((w, ch) => w + (/\s/.test(ch) ? spaceWidth : charWidth), 0)
}

interface FontSpec {
  family: string
  sizePx: number
  letterSpacingPx: number
  wordSpacingPx: number
}

/** Reads the stage font actually applied by CSS (set from ui.json by App). */
function stageFontSpec(): FontSpec {
  const probe = document.createElement('span')
  probe.style.cssText =
    'position:absolute;visibility:hidden;font-family:var(--stage-font);font-size:var(--stage-font-size);' +
    'letter-spacing:var(--stage-letter-spacing);word-spacing:var(--stage-word-spacing)'
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const spec = {
    family: style.fontFamily,
    sizePx: parseFloat(style.fontSize) || 16,
    letterSpacingPx: parseFloat(style.letterSpacing) || 0,
    wordSpacingPx: parseFloat(style.wordSpacing) || 0,
  }
  probe.remove()
  return spec
}

/**
 * Canvas measurer reproducing CSS layout: glyph advances from the real font, plus
 * letter-spacing per character and word-spacing per space (applied manually so it works
 * regardless of canvas letterSpacing support).
 */
function canvasMeasure(spec: FontSpec): MeasureText | null {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.font = `${spec.sizePx}px ${spec.family}`
  return (text) => {
    const chars = [...text].length
    const spaces = (text.match(/ /g) ?? []).length
    return context.measureText(text).width + chars * spec.letterSpacingPx + spaces * spec.wordSpacingPx
  }
}

/**
 * Layout for the dialogue box using real font metrics. The UI loader has already loaded every
 * bundled face in the stage stack; this final Font Loading API wait guards the effective CSS
 * request before canvas measurement.
 */
export async function dialogueTextLayout(locale = document.documentElement.lang || 'en'): Promise<TextLayout> {
  const spec = stageFontSpec()
  try {
    await document.fonts.load(`${spec.sizePx}px ${spec.family}`)
  } catch {
    // Font loading API unavailable: measure with whatever is active.
  }
  return { measure: canvasMeasure(spec) ?? gridMeasure(), lineWidths: dialogueLineWidths(), locale }
}
