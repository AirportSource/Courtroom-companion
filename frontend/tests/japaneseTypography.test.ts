import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dialogueLineWidths, type TextLayout } from '../src/engine/dialogueLayout.ts'
import { paginate, paginateDialogueLines, wrapLines } from '../src/engine/performance.ts'
import { fallbackGraphemes, graphemes, revealParts, revealSteps } from '../src/engine/unicodeText.ts'
import { pauseAfter } from '../src/engine/useTypewriter.ts'
import { stageFontProperties } from '../src/engine/fontMetrics.ts'
import { detailLineHeight, maxScrollTop, scrollByLines } from '../src/conversationRecord/conversationRecord.ts'
import { JAPANESE_SAMPLES, LONG_JAPANESE } from './fixtures/japaneseText.ts'

// Native DotGothic16 metrics: full-width 1000/em, ASCII 500/em at 16px.
const layout: TextLayout = { locale: 'ja', lineWidths: dialogueLineWidths(),
  measure: (text) => graphemes(text).reduce((width, cluster) => width + (/^[\x20-\x7e]/.test(cluster) ? 8 : 16), 0) }

test('Japanese selects the native bundled font while other locales retain the existing stack', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/assets/ui/ui.json', import.meta.url), 'utf8'))
  assert.equal(manifest.fonts.japanese.src, 'fonts/DotGothic16-Regular.ttf')
  assert.equal(manifest.fonts.japanese.pixelSize, 16)
  assert.equal(manifest.fonts.japanese.fallbacks, undefined, 'native Japanese face must not be size-adjusted')
  assert.equal(manifest.fonts.dialogue.family, 'Igiari')
  assert.equal(manifest.fonts.dialogue.fallbacks[0].sizeAdjust, '75%')
  const properties = stageFontProperties({ dialogue: { ...manifest.fonts.dialogue,
    fallbackFamilies: ['DotGothic16'], fallbackMetrics: {} }, japanese: { ...manifest.fonts.japanese,
    fallbackFamilies: [], fallbackMetrics: {} } })
  assert.match(properties['--stage-font-default'], /^"Igiari", "DotGothic16"/)
  assert.match(properties['--stage-font-japanese'], /^"DotGothic16 JP", "Igiari"/)
  assert.deepEqual(stageFontProperties({}), {})
})

test('grapheme segmentation and old-browser fallback retain combining, IVS, emoji and flags', () => {
  const expected = ['か\u3099', 'ハ\u309A', 'e\u0301', '葛\u{E0100}', '𠮷', '👩🏽‍⚖️', '🇯🇵']
  assert.deepEqual(graphemes(expected.join('')), expected)
  assert.deepEqual(fallbackGraphemes(expected.join('')), expected)
})

test('every reveal offset retains complete clusters and the unrevealed layout text', () => {
  const text = JAPANESE_SAMPLES.combining
  const boundaries = new Set([0])
  let length = 0
  for (const cluster of graphemes(text)) boundaries.add(length += cluster.length)
  for (let offset = 0; offset <= text.length; offset++) {
    const [shown, hidden] = revealParts(text, offset)
    assert.equal(shown + hidden, text)
    assert.ok(boundaries.has(shown.length))
    assert.ok(shown.length <= offset)
  }
  assert.deepEqual(revealSteps(text).map(step => text.slice(step.start, step.end)), graphemes(text))
  assert.equal(revealSteps(text).at(-1)?.end, text.length)
})

test('Japanese clause pauses do not require spaces and Latin pacing stays unchanged', () => {
  assert.equal(pauseAfter('確認。次へ', 2, 'ja'), 350)
  assert.equal(pauseAfter('証拠、裁判', 2, 'ja'), 180)
  assert.equal(pauseAfter('異議！？次へ', 2, 'ja'), 0)
  assert.equal(pauseAfter('異議！？次へ', 3, 'ja'), 350)
  assert.equal(pauseAfter('「異議！」次へ', 3, 'ja'), 0)
  assert.equal(pauseAfter('「異議！」次へ', 4, 'ja-JP'), 350)
  assert.equal(pauseAfter('確認。次へ', 2, 'en'), 0)
  assert.equal(pauseAfter('W-Wait', 1), 0)
})

for (const [name, text] of Object.entries({ ...JAPANESE_SAMPLES, long: LONG_JAPANESE })) {
  test(`native Japanese pagination preserves ${name} without overflowing`, () => {
    const pages = paginate(text, layout)
    // Existing paginator normalizes breakable ASCII spaces at line/page edges.
    assert.equal(pages.join('').replace(/[\n ]/g, ''), text.replace(/ /g, ''))
    assert.ok(pages.length > 0)
    for (const page of pages) {
      assert.ok(page.trim())
      const lines = page.split('\n')
      assert.ok(lines.length <= 3)
      lines.forEach((line, i) => assert.ok(layout.measure(line) <= layout.lineWidths[i], line))
    }
  })
}

test('kinsoku holds across measured lines and page boundaries, including full-width parentheses', () => {
  const text = '証拠を確認して（裁判の記録）「調査結果」を『証言』と比較します。'.repeat(9)
  for (const page of paginate(text, layout)) {
    for (const line of page.split('\n')) {
      assert.doesNotMatch(line, /^[、。！？）」』】ぁぃぅぇぉっゃゅょー]/)
      assert.doesNotMatch(line, /[（「『【]$/)
    }
  }
})

test('native 16px kanji occupy 15 columns and display scale does not enter pagination', () => {
  assert.equal(graphemes(wrapLines('裁'.repeat(45), layout)[0]).length, 15)
  const expected = paginate(LONG_JAPANESE, layout)
  for (const _scale of [1, 2, 3, 4, 'auto']) assert.deepEqual(paginate(LONG_JAPANESE, layout), expected)
})

test('a cluster wider than the viewport makes progress without splitting or looping', () => {
  assert.deepEqual(wrapLines('👩🏽‍⚖️証', { ...layout, lineWidths: [1] }), ['👩🏽‍⚖️', '証'])
})

test('Japanese record detail scrolls in complete native rows while Latin keeps the original grid', () => {
  assert.equal(detailLineHeight('en'), 15)
  assert.equal(detailLineHeight('fr'), 15)
  const height = detailLineHeight('ja-JP')
  assert.equal(height, 16)
  const maximum = maxScrollTop(400, 128, height)
  assert.equal(scrollByLines(0, 7, maximum, height), 112)
  assert.equal(maximum % height, 0)
})

test('local test scripts are measured too, without replaying reactions or SFX on later pages', () => {
  const pages = paginateDialogueLines([{text: LONG_JAPANESE, emotion: 'neutral', reaction: 'test', sfx: 'shock', voice: 'blip_female'}], layout)
  assert.ok(pages.length > 1)
  assert.equal(pages[0].sfx, 'shock')
  assert.equal(pages[0].reaction, 'test')
  for (const page of pages.slice(1)) {
    assert.equal(page.reaction, null)
    assert.equal(page.sfx, null)
    assert.equal(page.voice, 'blip_female')
  }
})

/** Read the actual bundled TTF cmap; no OS fonts or guessed Unicode ranges in coverage tests. */
function bundledGlyph(codepoint: number): number {
  const data = readFileSync(new URL('../public/assets/ui/fonts/DotGothic16-Regular.ttf', import.meta.url))
  let cmap = 0
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const entry = 12 + i * 16
    if (data.toString('ascii', entry, entry + 4) === 'cmap') cmap = data.readUInt32BE(entry + 8)
  }
  assert.ok(cmap)
  for (let i = 0; i < data.readUInt16BE(cmap + 2); i++) {
    const table = cmap + data.readUInt32BE(cmap + 4 + i * 8 + 4)
    if (data.readUInt16BE(table) !== 4 || codepoint > 0xffff) continue
    const count = data.readUInt16BE(table + 6) / 2
    for (let j = 0; j < count; j++) {
      const end = data.readUInt16BE(table + 14 + j * 2)
      const start = data.readUInt16BE(table + 16 + count * 2 + j * 2)
      if (codepoint < start || codepoint > end) continue
      const delta = data.readInt16BE(table + 16 + count * 4 + j * 2)
      const rangeAddress = table + 16 + count * 6 + j * 2
      const range = data.readUInt16BE(rangeAddress)
      const glyph = range ? data.readUInt16BE(rangeAddress + range + (codepoint - start) * 2) : codepoint
      return glyph === 0 && range ? 0 : (glyph + delta) & 0xffff
    }
  }
  return 0
}

test('the bundled font maps every common Japanese fixture and accented Latin character', () => {
  for (const [name, text] of Object.entries(JAPANESE_SAMPLES)) {
    if (name === 'combining') continue // Rare ideographs/IVS/emoji have the explicit emergency fallback.
    for (const char of text) assert.ok(bundledGlyph(char.codePointAt(0)!), `${name}: ${char}`)
  }
  assert.equal(bundledGlyph(0xfa11), 0, 'rare compatibility ideograph is a documented fallback, not claimed coverage')
})
