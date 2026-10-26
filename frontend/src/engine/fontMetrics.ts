// CSS font metric descriptors for bundled fallback fonts (ui.json `fallbacks[].sizeAdjust`...).
// The face is registered through an @font-face rule so DOM text and the paginator's canvas
// measurer (same family, same face) get identical effective metrics, with no per-script code.
import type { FontMetricDescriptors, UiFont } from './manifestTypes.ts'

/** Shared DOM/canvas font configuration; fonts have finished loading before this is applied. */
export function stageFontProperties(fonts: Record<string, UiFont>): Record<string, string> {
  const font = fonts.dialogue
  if (!font) return {}
  const stack = [font.family, ...font.fallbackFamilies].map((family) => JSON.stringify(family)).join(', ')
  const properties: Record<string, string> = {
    '--stage-font-default': `${stack}, var(--stage-font-fallback)`,
    '--stage-font-size': `${font.pixelSize}px`,
    '--stage-letter-spacing': `${font.letterSpacing}px`,
    '--stage-word-spacing': `${font.wordSpacing}px`,
  }
  if (fonts.japanese) properties['--stage-font-japanese'] =
    `${JSON.stringify(fonts.japanese.family)}, ${JSON.stringify(font.family)}, var(--stage-font-fallback)`
  return properties
}

const KEYS = ['sizeAdjust', 'ascentOverride', 'descentOverride', 'lineGapOverride'] as const
const CSS_NAMES: Record<(typeof KEYS)[number], string> = {
  sizeAdjust: 'size-adjust',
  ascentOverride: 'ascent-override',
  descentOverride: 'descent-override',
  lineGapOverride: 'line-gap-override',
}
/** A strictly positive percentage such as "87.5%" (size-adjust must be > 0). */
const PERCENT = /^(?:\d{1,3}(?:\.\d{1,3})?)%$/

/** Keeps only well-formed descriptors; anything else is ignored (never injected into CSS). */
export function readFontMetrics(raw: unknown): FontMetricDescriptors {
  const out: FontMetricDescriptors = {}
  if (typeof raw !== 'object' || raw === null) return out
  const record = raw as Record<string, unknown>
  for (const key of KEYS) {
    const value = record[key]
    if (typeof value === 'string' && PERCENT.test(value) && parseFloat(value) > 0) out[key] = value
  }
  return out
}

export function hasFontMetrics(metrics: FontMetricDescriptors): boolean {
  return KEYS.some((key) => metrics[key] !== undefined)
}

/** The effective size multiplier of a descriptor set (1 when unset). */
export function sizeScale(metrics: FontMetricDescriptors): number {
  return metrics.sizeAdjust ? parseFloat(metrics.sizeAdjust) / 100 : 1
}

/** `@font-face` rule for `family` loaded from `url` with the given metric descriptors. */
export function fontFaceCss(family: string, url: string, metrics: FontMetricDescriptors): string {
  const descriptors = KEYS.filter((key) => metrics[key] !== undefined).map((key) => `${CSS_NAMES[key]}:${metrics[key]}`)
  return `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(url)});${descriptors.join(';')}}`
}
