// Japanese pagination with the kanji fallback scale from ui.json (DotGothic16 sizeAdjust).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DIALOGUE_TEXT, dialogueLineWidths, type TextLayout } from '../src/engine/dialogueLayout.ts'
import { fontFaceCss, hasFontMetrics, readFontMetrics, sizeScale } from '../src/engine/fontMetrics.ts'
import { paginate, wrapLines } from '../src/engine/performance.ts'

const ui = JSON.parse(readFileSync(new URL('../public/assets/ui/ui.json', import.meta.url), 'utf8'))
const font = ui.fonts.dialogue
const metrics = readFontMetrics(font.fallbacks[0])
const scale = sizeScale(metrics)

/** Igiari kana advance is 896/1024 em = 14px at 16px; DotGothic16 glyphs are 1em wide, scaled. */
const KANA = /[぀-ヿ]/
const IDEOGRAPH = /[㐀-鿿]/
const FULLWIDTH_PUNCT = /[、。！？，]/
function jaMeasure(ideographScale: number) {
  return (text: string) =>
    [...text].reduce((w, ch) => {
      if (IDEOGRAPH.test(ch)) return w + font.pixelSize * ideographScale
      if (KANA.test(ch) || FULLWIDTH_PUNCT.test(ch)) return w + 14
      return w + 10
    }, 0)
}
const layout: TextLayout = { measure: jaMeasure(scale), lineWidths: dialogueLineWidths(), locale: 'ja' }

test('ui.json declares a valid DotGothic16 size scale', () => {
  assert.equal(metrics.sizeAdjust, '75%')
  assert.ok(hasFontMetrics(metrics))
  assert.equal(scale, 0.75)
  // 12px effective: kanji ink ~11px, matching Igiari's 11px kana ink height.
  assert.equal(font.pixelSize * scale, 12)
})

test('font metric descriptors are validated and rendered to CSS', () => {
  assert.deepEqual(readFontMetrics({ sizeAdjust: '75%', ascentOverride: 'url(x)', descentOverride: '0%' }), {
    sizeAdjust: '75%',
  })
  assert.deepEqual(readFontMetrics(null), {})
  assert.equal(sizeScale({}), 1)
  const css = fontFaceCss('DotGothic16', 'fonts/a.ttf', { sizeAdjust: '75%' })
  assert.match(css, /font-family:"DotGothic16"/)
  assert.match(css, /size-adjust:75%/)
  assert.doesNotMatch(fontFaceCss('A', 'b.ttf', {}), /size-adjust/)
})

const SAMPLES = ['幽霊が怖いんだよね', '真宵ちゃん、この証拠ちょっと変じゃない？', '今日は裁判所に行こう']

function assertFits(pages: string[]) {
  for (const page of pages) {
    const lines = page.split('\n')
    assert.ok(lines.length <= DIALOGUE_TEXT.maxLines, `too many lines: ${JSON.stringify(page)}`)
    lines.forEach((line, i) => assert.ok(layout.measure(line) <= layout.lineWidths[i], `clipped: ${line}`))
  }
}

for (const sample of SAMPLES) {
  test(`short Japanese fits one page without spaces: ${sample}`, () => {
    const pages = paginate(sample, layout)
    assert.equal(pages.join('').replaceAll('\n', ''), sample)
    assertFits(pages)
    assert.equal(pages.length, 1)
  })
}

test('long Japanese paginates with no clipping and no content loss', () => {
  const text = SAMPLES.join('')
  const pages = paginate(text, layout)
  assertFits(pages)
  assert.equal(pages.join('').replaceAll('\n', ''), text)
})

test('Japanese punctuation never starts a line', () => {
  const text = '真宵ちゃん、この証拠ちょっと変じゃない？今日は裁判所に行こう。幽霊が怖いんだよね！'.repeat(2)
  for (const page of paginate(text, layout)) {
    for (const line of page.split('\n')) assert.doesNotMatch(line, /^[、。！？，]/)
  }
})

test('line capacity uses the scaled kanji pitch (20 kanji per line, not 15)', () => {
  const kanji = '裁'.repeat(40)
  assert.equal(wrapLines(kanji, layout)[0].length, 20)
  const unscaled: TextLayout = { ...layout, measure: jaMeasure(1) }
  assert.equal(wrapLines(kanji, unscaled)[0].length, 15)
})
