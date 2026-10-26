// Court Record and Talk Options tests: the real manifest and PNGs, pixel identity with the source
// sheets (skipped when docs/references is absent), and the pure navigation/ordering rules.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  entriesOfType,
  validateCourtRecordManifest,
  type CourtRecordEntry,
} from '../src/courtRecord/courtRecord.ts'
import {
  GRID,
  cellOrigin,
  cycleTab,
  gridMove,
  gridRowCount,
  pageMove,
  scrollStart,
} from '../src/courtRecord/courtRecordNav.ts'
import {
  firstSelectable,
  moveSelection,
  pageSelection,
  sortTalkOptions,
  type TalkOption,
} from '../src/courtRecord/talkOptions.ts'
import { DEV_TALK_TOPICS } from '../src/dev/talkTopics.ts'
import { cropRgba, decodePng, readPngHeader, rgbDifferences } from './support/png.ts'

const assetsDir = fileURLToPath(new URL('../public/assets/', import.meta.url))
const crDir = `${assetsDir}court-record/`
const refs = (name: string) => fileURLToPath(new URL(`../../docs/references/${name}`, import.meta.url))
const SHEET_PATH = refs('court-record/evidences_profiles_full.png')
const MISC_PATH = refs('DS _ DSi - Phoenix Wright_ Ace Attorney - Backgrounds - Miscellaneous.png')
const UNDER_SCREEN_PATH = refs('court-record/under_screen_background.png')
const THINKER_REF_PATH = refs('court-record/penseur.png')

const sourceSheetMissing = existsSync(SHEET_PATH) ? false : 'docs/references/court-record is absent'
const miscSheetMissing = existsSync(MISC_PATH) ? false : 'Miscellaneous background sheet is absent'
const underScreenMissing = existsSync(UNDER_SCREEN_PATH) ? false : 'Talk Option screenshot is absent'

const manifestRaw: unknown = JSON.parse(readFileSync(`${crDir}court-record.json`, 'utf8'))
const { entries: liveEntries, warnings: liveWarnings } = validateCourtRecordManifest(manifestRaw)

// ---- Manifest against the real data ----

test('court-record.json validates with no warnings and lists the three evidence icons', () => {
  assert.deepEqual(liveWarnings, [])
  assert.deepEqual(
    liveEntries.map((entry) => entry.id),
    ['thinker_statue', 'envelope_tied', 'cellphone_blue'],
  )
  assert.equal(entriesOfType({ entries: liveEntries }, 'profile').length, 0, 'profiles stay empty for now')
})

test('evidence ids are unique, well-formed and every entry is in the order lists', () => {
  const ids = liveEntries.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[a-z0-9][a-z0-9_]*$/)
  const listed = (manifestRaw as { order: { evidence: string[]; profiles: string[] } }).order
  assert.deepEqual([...listed.evidence].sort(), [...ids].sort())
  assert.deepEqual(listed.profiles, [])
})

test('every icon exists on disk and its PNG header matches the manifest size', () => {
  for (const entry of liveEntries) {
    const file = `${crDir}${entry.asset.src}`
    assert.ok(existsSync(file), `${entry.id}: missing ${entry.asset.src}`)
    const header = readPngHeader(readFileSync(file))
    assert.equal(header.width, entry.asset.width, `${entry.id}: width`)
    assert.equal(header.height, entry.asset.height, `${entry.id}: height`)
    assert.equal(header.width, 64, `${entry.id}: icon slot is 64 px`)
  }
})

test('the icon sheet is not referenced by any runtime path (no sheet coordinates in components)', () => {
  const uses = (file: string) => readFileSync(file, 'utf8')
  for (const file of ['../src/components/CourtRecordView.tsx', '../src/components/TalkOptions.tsx']) {
    const source = uses(fileURLToPath(new URL(file, import.meta.url)))
    assert.doesNotMatch(source, /evidences_profiles|docs\/references/)
  }
})

// ---- Pixel identity with the source sheets ----

test('native icon RGB pixels are identical to their sheet rectangles', { skip: sourceSheetMissing }, () => {
  const sheet = decodePng(readFileSync(SHEET_PATH))
  assert.equal(sheet.width, 1008)
  assert.equal(sheet.height, 711)
  let compared = 0
  for (const entry of liveEntries) {
    const rect = entry.provenance?.rect
    assert.ok(rect, `${entry.id}: provenance rectangle required`)
    assert.ok(rect.x + rect.width <= sheet.width && rect.y + rect.height <= sheet.height, `${entry.id}: rect outside sheet`)
    const icon = decodePng(readFileSync(`${crDir}${entry.asset.src}`))
    const source = cropRgba(sheet, rect.x, rect.y, rect.width, rect.height)
    const differences = rgbDifferences(icon.rgba, source)
    compared += icon.width * icon.height
    assert.equal(differences, 0, `${entry.id}: ${differences} channel differences`)
  }
  assert.equal(compared, liveEntries.length * 64 * 64)
})

test('phone evidence clears the exterior slot matte without erasing the handset', () => {
  const phone = decodePng(readFileSync(`${crDir}evidence/cellphone_blue.png`))
  assert.equal(phone.colorType, 6, 'phone must be a genuine RGBA PNG')
  let transparent = 0
  let opaque = 0
  let semiTransparent = 0
  for (let i = 3; i < phone.rgba.length; i += 4) {
    if (phone.rgba[i] === 0) transparent++
    else if (phone.rgba[i] === 255) opaque++
    else semiTransparent++
  }
  assert.equal(semiTransparent, 0, 'pixel-art edges must remain binary-alpha')
  assert.ok(transparent > phone.width * phone.height / 2, 'the surrounding matte must be transparent')
  assert.ok(opaque > 500, 'the detailed handset must remain visible')
  const alphaAt = (x: number, y: number) => phone.rgba[(y * phone.width + x) * 4 + 3]
  for (const [x, y] of [[0, 0], [phone.width - 1, 0], [0, phone.height - 1], [phone.width - 1, phone.height - 1]]) {
    assert.equal(alphaAt(x, y), 0, `corner ${x},${y} must reveal the evidence window`)
  }
  const perimeter = [
    ...Array.from({ length: phone.width }, (_, x) => alphaAt(x, 0)),
    ...Array.from({ length: phone.width }, (_, x) => alphaAt(x, phone.height - 1)),
    ...Array.from({ length: phone.height - 2 }, (_, y) => alphaAt(0, y + 1)),
    ...Array.from({ length: phone.height - 2 }, (_, y) => alphaAt(phone.width - 1, y + 1)),
  ]
  assert.ok(perimeter.filter((alpha) => alpha === 0).length > perimeter.length * 0.9,
    'the exterior must not be an opaque rectangular matte')
})

test('the Thinker enlarged reference is the sheet tile at row 1, column 7 (exact 1:1 window)', { skip: sourceSheetMissing || (existsSync(THINKER_REF_PATH) ? false : 'penseur.png is absent') }, () => {
  const sheet = decodePng(readFileSync(SHEET_PATH))
  const reference = decodePng(readFileSync(THINKER_REF_PATH))
  assert.equal(reference.width, 70)
  assert.equal(reference.height, 70)
  // Tile origin for column 7 is x = 1 + 71 * 6 = 427; the reference is cropped one pixel right.
  const window = cropRgba(sheet, 428, 1, 70, 70)
  assert.equal(rgbDifferences(reference.rgba, window), 0)
})

test('talk-option backdrop is the Miscellaneous sheet panel and the Talk Option screenshot interior', { skip: miscSheetMissing }, () => {
  const backdrop = decodePng(readFileSync(`${assetsDir}ui/menu/talk-option.png`))
  assert.equal(backdrop.width, 256)
  assert.equal(backdrop.height, 192)
  const misc = decodePng(readFileSync(MISC_PATH))
  assert.equal(rgbDifferences(backdrop.rgba, cropRgba(misc, 1139, 23, 256, 192)), 0)
  if (!underScreenMissing) {
    const screenshot = decodePng(readFileSync(UNDER_SCREEN_PATH))
    assert.equal(rgbDifferences(backdrop.rgba, cropRgba(screenshot, 10, 14, 256, 192)), 0)
  }
})

test('talk-option backdrop file exists and is registered in ui.json as menu_talk_option', () => {
  assert.ok(existsSync(`${assetsDir}ui/menu/talk-option.png`))
  const ui = JSON.parse(readFileSync(`${assetsDir}ui/ui.json`, 'utf8'))
  assert.deepEqual(ui.images.menu_talk_option, { src: 'menu/talk-option.png', width: 256, height: 192 })
})

// ---- Validator ----

const goodEntry = (overrides: Partial<CourtRecordEntry> = {}): CourtRecordEntry => ({
  id: 'sample_item',
  type: 'evidence',
  name: 'Sample',
  description: 'A sample item.',
  asset: { src: 'evidence/sample.png', width: 64, height: 64 },
  ...overrides,
})

test('validator rejects an unusable document (wrong version or no entries array)', () => {
  assert.throws(() => validateCourtRecordManifest({ version: 2, entries: [], order: {} }))
  assert.throws(() => validateCourtRecordManifest({ version: 1, order: {} }))
  assert.throws(() => validateCourtRecordManifest('nonsense'))
})

test('validator drops bad entries with a warning and keeps the good ones', () => {
  const raw = {
    version: 1,
    entries: [
      goodEntry(),
      goodEntry({ id: 'sample_item' }), // duplicate id
      goodEntry({ id: 'Bad Id' }),
      goodEntry({ id: 'bad_type', type: 'note' as 'evidence' }),
      goodEntry({ id: 'no_name', name: '  ' }),
      goodEntry({ id: 'escape', asset: { src: '../secret.png', width: 64, height: 64 } }),
      goodEntry({ id: 'not_png', asset: { src: 'evidence/a.jpg', width: 64, height: 64 } }),
      goodEntry({ id: 'zero_size', asset: { src: 'evidence/z.png', width: 0, height: 64 } }),
    ],
    order: { evidence: ['sample_item'], profiles: [] },
  }
  const result = validateCourtRecordManifest(raw)
  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    ['sample_item'],
  )
  // duplicate id, bad id, bad type, empty name, escaping path, non-PNG path, zero size
  assert.equal(result.warnings.length, 7)
})

test('order lists place entries in display order; unlisted entries are appended; mistyped ids are ignored', () => {
  const raw = {
    version: 1,
    entries: [
      goodEntry({ id: 'first' }),
      goodEntry({ id: 'second' }),
      goodEntry({ id: 'profile_one', type: 'profile', name: 'One' }),
      goodEntry({ id: 'unlisted' }),
    ],
    order: { evidence: ['second', 'first', 'profile_one', 'missing'], profiles: ['second', 'profile_one'] },
  }
  const result = validateCourtRecordManifest(raw)
  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    ['second', 'first', 'unlisted', 'profile_one'],
  )
  assert.equal(result.warnings.filter((w) => w.includes('ignored')).length, 3, result.warnings.join('\n'))
  assert.ok(result.warnings.some((w) => w.includes('"unlisted": not listed')))
})

test('malformed provenance keeps the entry and drops only the provenance', () => {
  const raw = {
    version: 1,
    entries: [goodEntry({ id: 'kept', provenance: { source: 'x.png', rect: { x: -1, y: 0, width: 64, height: 64 } } as CourtRecordEntry['provenance'] })],
    order: { evidence: ['kept'], profiles: [] },
  }
  const result = validateCourtRecordManifest(raw)
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].provenance, undefined)
  assert.ok(result.warnings.some((w) => w.includes('provenance malformed')))
})

test('entriesOfType filters by type and keeps display order', () => {
  const record = {
    entries: [
      { id: 'a', type: 'evidence' as const },
      { id: 'b', type: 'profile' as const },
      { id: 'c', type: 'evidence' as const },
    ],
  }
  assert.deepEqual(entriesOfType(record, 'evidence').map((e) => e.id), ['a', 'c'])
  assert.deepEqual(entriesOfType(record, 'profile').map((e) => e.id), ['b'])
})

// ---- Navigation and layout ----

test('grid moves by column and row, clamping at the edges without wrapping', () => {
  assert.equal(gridMove(0, 7, 'left'), 0)
  assert.equal(gridMove(0, 7, 'up'), 0)
  assert.equal(gridMove(0, 7, 'right'), 1)
  assert.equal(gridMove(0, 7, 'down'), 3)
  assert.equal(gridMove(6, 7, 'right'), 6)
  assert.equal(gridMove(6, 7, 'down'), 6)
  assert.equal(gridMove(4, 7, 'down'), 4, 'row below does not exist')
  assert.equal(gridMove(4, 7, 'up'), 1)
  assert.equal(gridMove(0, 0, 'right'), 0, 'empty grid stays at 0')
  assert.equal(gridRowCount(7), 3)
})

test('PageUp/PageDown move a visible page and clamp', () => {
  const page = GRID.columns * GRID.rows
  assert.equal(pageMove(0, 20, 'next'), page)
  assert.equal(pageMove(18, 20, 'next'), 19)
  assert.equal(pageMove(2, 20, 'prev'), 0)
  assert.equal(pageMove(0, 0, 'next'), 0)
})

test('tabs cycle in both directions', () => {
  assert.equal(cycleTab('evidence', 'next'), 'profiles')
  assert.equal(cycleTab('profiles', 'next'), 'evidence')
  assert.equal(cycleTab('evidence', 'prev'), 'profiles')
})

test('scrolling keeps the selected row visible and moves as little as possible', () => {
  assert.equal(scrollStart(0, 0, 2, 5), 0)
  assert.equal(scrollStart(2, 0, 2, 5), 1, 'one row past the window scrolls by one')
  assert.equal(scrollStart(1, 1, 2, 5), 1, 'already visible: no movement')
  assert.equal(scrollStart(0, 3, 2, 5), 0, 'above the window scrolls up')
  assert.equal(scrollStart(4, 0, 2, 5), 3, 'last row clamps to the final window')
  assert.equal(scrollStart(1, 0, 2, 1), 0, 'fewer rows than the window never scrolls')
})

test('grid cells are centred, do not overlap, and sit above the detail panel', () => {
  const rects: { x: number; y: number }[] = []
  for (let row = 0; row < GRID.rows; row++) {
    for (let column = 0; column < GRID.columns; column++) rects.push(cellOrigin(column, row))
  }
  const right = Math.max(...rects.map((r) => r.x + GRID.cell))
  const left = Math.min(...rects.map((r) => r.x))
  assert.equal(left, 256 - right, 'horizontally centred on the 256 px stage')
  const bottom = Math.max(...rects.map((r) => r.y + GRID.cell))
  assert.ok(bottom <= 156, `grid ends at ${bottom}, detail panel starts at 156`)
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const overlaps = a.x < b.x + GRID.cell && b.x < a.x + GRID.cell && a.y < b.y + GRID.cell && b.y < a.y + GRID.cell
      assert.equal(overlaps, false, `cells ${i} and ${j} overlap`)
    }
  }
})

// ---- Talk Options ---- 

const topics: TalkOption[] = [
  { id: 'c', label: 'C', order: 2 },
  { id: 'a', label: 'A', order: 0 },
  { id: 'off', label: 'Off', enabled: false, order: 1 },
  { id: 'b', label: 'B', order: 0 },
  { id: 'd', label: 'D' },
]

test('talk options sort by order, then original position, without mutating the input', () => {
  const before = topics.map((t) => t.id)
  const sorted = sortTalkOptions(topics).map((t) => t.id)
  assert.deepEqual(sorted, ['a', 'b', 'd', 'off', 'c'])
  assert.deepEqual(topics.map((t) => t.id), before)
})

test('talk option selection skips disabled entries and wraps', () => {
  const list = sortTalkOptions(topics)
  const first = firstSelectable(list)
  assert.equal(list[first].id, 'a')
  const down = [first]
  for (let i = 0; i < 4; i++) down.push(moveSelection(list, down[i], 1))
  assert.deepEqual(down.map((i) => list[i].id), ['a', 'b', 'd', 'c', 'a'])
  assert.equal(list[moveSelection(list, 0, -1)].id, 'c', 'upwards from the top wraps to the last enabled')
  assert.equal(moveSelection(list, 1, 1), 2)
})

test('talk option selection reports nothing selectable when every option is disabled', () => {
  const locked: TalkOption[] = [{ id: 'x', label: 'X', enabled: false }]
  assert.equal(firstSelectable(locked), -1)
  assert.equal(moveSelection(locked, -1, 1), -1)
  assert.equal(moveSelection([], 0, 1), -1)
})

test('PageUp/PageDown land on the nearest selectable option without wrapping', () => {
  const list: TalkOption[] = [
    { id: '0', label: '0' },
    { id: '1', label: '1', enabled: false },
    { id: '2', label: '2' },
    { id: '3', label: '3', enabled: false },
  ]
  assert.equal(pageSelection(list, 0, 1, 2), 2, 'target 2 is selectable')
  assert.equal(pageSelection(list, 0, 1, 1), 2, 'disabled target moves on to the next selectable')
  assert.equal(pageSelection(list, 2, 1, 5), 2, 'nothing further down: stays put')
  assert.equal(pageSelection(list, 2, -1, 9), 0, 'clamped to the top')
})

test('dev sample topics are valid: unique ids, one disabled, one marked new', () => {
  const ids = DEV_TALK_TOPICS.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(DEV_TALK_TOPICS.some((t) => t.enabled === false))
  assert.ok(DEV_TALK_TOPICS.some((t) => t.isNew))
  assert.notEqual(firstSelectable(sortTalkOptions(DEV_TALK_TOPICS)), -1)
})
