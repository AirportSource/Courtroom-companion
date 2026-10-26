// Worker D: conversation music policy (pure functions), the override store, the request mapping and
// the extended soundtrack manifest (profiles, short titles, loop status).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  activeOverrideTrack,
  baselineTrackFor,
  buildTrackList,
  effectiveTrackFor,
  isSelectableTrack,
  overrideAfterSelect,
  reconcileOverride,
  stepTrack,
  themeTrackFor,
  type TrackOverride,
} from '../src/music/conversationMusic.ts'
import { conversationMusicStore } from '../src/music/conversationMusicStore.ts'
import { parseLoopMetadata } from '../src/music/loopMath.ts'
import { musicRequestFor, type MusicSettings } from '../src/music/musicRuntime.ts'
import {
  bgmPool,
  selectablePool,
  trackListLabel,
  trackShortTitle,
  validateSoundtrackManifest,
  type SoundtrackManifest,
} from '../src/music/soundtrack.ts'

const real: SoundtrackManifest = JSON.parse(
  readFileSync(new URL('../public/assets/music/soundtrack.json', import.meta.url), 'utf8'),
)

function track(src: string | undefined, category: 'bgm' | 'contextual' | 'excluded', title: string, shortTitle?: string) {
  return {
    number: 1, title, ...(shortTitle ? { shortTitle } : {}), ...(src ? { src } : {}), category, tags: [], gain: 1,
    contextual: category === 'contextual', loop: null,
  }
}

const synthetic: SoundtrackManifest = {
  version: 1,
  profiles: {
    default: { defaultTrack: 'a', alternatives: [] },
    maya: { defaultTrack: 'b', alternatives: ['a'] },
    phoenix: { defaultTrack: 'c', alternatives: [] },
  },
  tracks: {
    a: track('original/a.mp3', 'bgm', 'Alpha Long Title', 'Alpha'),
    b: track('original/b.mp3', 'bgm', 'Bravo'),
    c: track('original/c.mp3', 'bgm', 'Charlie'),
    x: track('original/x.mp3', 'contextual', 'Xray Cue'),
    z: track(undefined, 'excluded', 'Zulu Jingle'),
  },
}

const settingsBase: MusicSettings = {
  musicSource: 'original', musicVolume: 0.5, musicMuted: false, originalTrackId: '', importedTrackId: '', radioVideoId: '',
}

// ---------------------------------------------------------------- selection helpers

test('selectable tracks are bgm + contextual with a file; excluded never', () => {
  assert.deepEqual(selectablePool(synthetic), ['a', 'b', 'c', 'x'])
  assert.equal(isSelectableTrack(synthetic, 'x'), true)
  assert.equal(isSelectableTrack(synthetic, 'z'), false)
  assert.equal(isSelectableTrack(synthetic, '__proto__'), false)
  assert.equal(isSelectableTrack(synthetic, ''), false)
  assert.equal(isSelectableTrack(null, 'a'), false)
})

test('theme comes from the character profile, then the default profile (data, not code)', () => {
  assert.equal(themeTrackFor(synthetic, 'maya'), 'b')
  assert.equal(themeTrackFor(synthetic, 'phoenix'), 'c')
  assert.equal(themeTrackFor(synthetic, 'unknown_character'), 'a')
  assert.equal(themeTrackFor(synthetic, ''), 'a')
  assert.equal(themeTrackFor(null, 'maya'), null)
})

test('baseline: the Settings-fixed track beats the theme; invalid fixed tracks fall back to the theme', () => {
  assert.equal(baselineTrackFor(synthetic, 'maya', ''), 'b')
  assert.equal(baselineTrackFor(synthetic, 'maya', 'c'), 'c')
  assert.equal(baselineTrackFor(synthetic, 'maya', 'z'), 'b') // excluded
  assert.equal(baselineTrackFor(synthetic, 'maya', 'gone'), 'b')
})

// ---------------------------------------------------------------- override scope

test('precedence: live override > Settings track > character theme', () => {
  const override: TrackOverride = { characterId: 'maya', trackId: 'x' }
  assert.equal(effectiveTrackFor(synthetic, 'maya', '', null), 'b')
  assert.equal(effectiveTrackFor(synthetic, 'maya', 'c', null), 'c')
  assert.equal(effectiveTrackFor(synthetic, 'maya', 'c', override), 'x')
  assert.equal(effectiveTrackFor(synthetic, 'maya', '', override), 'x')
})

test('an override applies to its own character only, and only while the track is valid', () => {
  const override: TrackOverride = { characterId: 'maya', trackId: 'x' }
  assert.equal(activeOverrideTrack(override, 'maya', synthetic), 'x')
  assert.equal(activeOverrideTrack(override, 'phoenix', synthetic), null)
  assert.equal(activeOverrideTrack(override, null, synthetic), null)
  assert.equal(activeOverrideTrack({ characterId: 'maya', trackId: 'z' }, 'maya', synthetic), null)
  assert.equal(activeOverrideTrack({ characterId: 'maya', trackId: 'x' }, 'maya', null), null)
  assert.equal(effectiveTrackFor(synthetic, 'phoenix', '', override), 'c') // switching character resets to its theme
})

test('reconcileOverride keeps the override for the same open conversation only', () => {
  const override: TrackOverride = { characterId: 'maya', trackId: 'x' }
  assert.equal(reconcileOverride(override, 'conversation', 'maya'), override)
  assert.equal(reconcileOverride(override, 'conversation', 'phoenix'), null)
  assert.equal(reconcileOverride(override, 'menu', 'maya'), null)
  assert.equal(reconcileOverride(override, 'menu', null), null)
  assert.equal(reconcileOverride(null, 'conversation', 'maya'), null)
})

test('selecting the baseline clears the override; unknown tracks change nothing', () => {
  assert.deepEqual(overrideAfterSelect(synthetic, 'maya', '', null, 'x'), { characterId: 'maya', trackId: 'x' })
  assert.equal(overrideAfterSelect(synthetic, 'maya', '', { characterId: 'maya', trackId: 'x' }, 'b'), null) // back to the theme
  const current: TrackOverride = { characterId: 'maya', trackId: 'x' }
  assert.equal(overrideAfterSelect(synthetic, 'maya', '', current, 'z'), current)
  assert.equal(overrideAfterSelect(synthetic, 'maya', '', current, 'nope'), current)
  // With a Settings-fixed track the baseline is that track, so "theme" is an explicit override.
  assert.deepEqual(overrideAfterSelect(synthetic, 'maya', 'c', null, 'b'), { characterId: 'maya', trackId: 'b' })
  assert.equal(overrideAfterSelect(synthetic, 'maya', 'c', { characterId: 'maya', trackId: 'b' }, 'c'), null)
})

test('stepTrack wraps and recovers from an unknown current track', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(stepTrack(ids, 'a', 1), 'b')
  assert.equal(stepTrack(ids, 'c', 1), 'a')
  assert.equal(stepTrack(ids, 'a', -1), 'c')
  assert.equal(stepTrack(ids, 'b', -1), 'a')
  assert.equal(stepTrack(ids, null, 1), 'a')
  assert.equal(stepTrack(ids, 'gone', 1), 'a')
  assert.equal(stepTrack(ids, 'gone', -1), 'c')
  assert.equal(stepTrack([], 'a', 1), null)
})

test('track list: ordered, labelled, theme and baseline flagged', () => {
  const list = buildTrackList(synthetic, 'maya', 'c')
  assert.deepEqual(list.map((item) => item.id), ['a', 'b', 'c', 'x'])
  assert.equal(list.find((item) => item.id === 'b')?.isTheme, true)
  assert.equal(list.find((item) => item.id === 'c')?.isBaseline, true)
  assert.equal(list[0].shortTitle, 'Alpha')
  assert.equal(list[0].title, 'Alpha Long Title')
  assert.equal(list[1].shortTitle, 'Bravo') // falls back to the title
  assert.deepEqual(buildTrackList(null, 'maya', ''), [])
})

// ---------------------------------------------------------------- engine request

test('musicRequestFor: the in-conversation override wins, but only for the original source', () => {
  const ctx = (trackOverride: string | null) => ({ scene: 'conversation' as const, characterId: 'maya', trackOverride })
  assert.deepEqual(musicRequestFor(settingsBase, synthetic, ctx(null)), { kind: 'original', trackId: 'b' })
  assert.deepEqual(musicRequestFor(settingsBase, synthetic, ctx('x')), { kind: 'original', trackId: 'x' })
  assert.deepEqual(musicRequestFor({ ...settingsBase, originalTrackId: 'c' }, synthetic, ctx('x')), { kind: 'original', trackId: 'x' })
  assert.deepEqual(musicRequestFor({ ...settingsBase, originalTrackId: 'c' }, synthetic, ctx(null)), { kind: 'original', trackId: 'c' })
  // an override pointing at an unusable track is ignored
  assert.deepEqual(musicRequestFor(settingsBase, synthetic, ctx('z')), { kind: 'original', trackId: 'b' })
  assert.deepEqual(musicRequestFor({ ...settingsBase, musicSource: 'radio' }, synthetic, ctx('x')).kind, 'radio')
  assert.deepEqual(musicRequestFor({ ...settingsBase, musicSource: 'off' }, synthetic, ctx('x')), { kind: 'off' })
  // menus never play an override
  assert.deepEqual(musicRequestFor(settingsBase, synthetic, { scene: 'menu' }), { kind: 'off' })
})

// ---------------------------------------------------------------- store

test('override store: publishes changes once, ignores identical values', () => {
  conversationMusicStore.reset()
  let calls = 0
  const off = conversationMusicStore.subscribe(() => calls++)
  conversationMusicStore.setOverride({ characterId: 'maya', trackId: 'x' })
  conversationMusicStore.setOverride({ characterId: 'maya', trackId: 'x' })
  assert.equal(calls, 1)
  assert.deepEqual(conversationMusicStore.getSnapshot().override, { characterId: 'maya', trackId: 'x' })
  conversationMusicStore.setSoundtrack(synthetic)
  conversationMusicStore.setSoundtrack(synthetic)
  assert.equal(calls, 2)
  conversationMusicStore.setOverride(null)
  assert.equal(conversationMusicStore.getSnapshot().override, null)
  off()
  conversationMusicStore.reset()
})

// ---------------------------------------------------------------- display names

test('short titles and list labels', () => {
  assert.equal(trackShortTitle({ title: 'Long', shortTitle: 'Short' }), 'Short')
  assert.equal(trackShortTitle({ title: 'Long' }), 'Long')
  assert.equal(trackListLabel({ title: 'L', shortTitle: 'Court', game: 'jfa' }), 'Court (JFA)')
  assert.equal(trackListLabel({ title: 'L', shortTitle: 'Court', game: 'tnt' }), 'Court (T&T)')
  assert.equal(trackListLabel({ title: 'L', shortTitle: 'Court', game: 'aa1' }), 'Court (AA)')
  assert.equal(trackListLabel({ title: 'L', shortTitle: 'Court' }), 'Court')
})

// ---------------------------------------------------------------- loop status (lenient)

test('loop status/method are optional and unknown values are dropped', () => {
  const base = { startSample: 0, endSample: 441000, sampleRate: 44100, confidence: 0.9, provenance: 'curated-analysis' }
  const measured = parseLoopMetadata({ ...base, status: 'measured_not_auditioned', method: 'lag-diagonal+xcorr-v1' })
  assert.equal(measured.status, 'measured_not_auditioned')
  assert.equal(measured.method, 'lag-diagonal+xcorr-v1')
  assert.equal(parseLoopMetadata({ ...base, status: 'auditioned' }).status, 'auditioned')
  const legacy = parseLoopMetadata(base)
  assert.equal('status' in legacy, false)
  assert.equal('method' in legacy, false)
  assert.equal('status' in parseLoopMetadata({ ...base, status: 'perfect', method: 42 }), false)
  assert.equal(parseLoopMetadata({ startSample: 5, endSample: 1, sampleRate: 44100, status: 'auditioned' }).region, null)
})

// ---------------------------------------------------------------- the real manifest

test('real manifest: valid, with optional display fields well-formed', () => {
  assert.deepEqual(validateSoundtrackManifest(real), [])
  for (const [id, entry] of Object.entries(real.tracks)) {
    assert.ok(entry.shortTitle && entry.shortTitle.length <= 40, `${id}: short title`)
    assert.ok(entry.game === 'aa1' || entry.game === 'jfa' || entry.game === 'tnt', `${id}: game`)
    assert.equal(entry.disc === undefined ? 'aa1' : entry.disc === 2 ? 'jfa' : 'tnt', entry.game, `${id}: disc/game agree`)
  }
  const errors = validateSoundtrackManifest({ ...real, tracks: { ...real.tracks, bad: { ...real.tracks.suspense, game: 'x', disc: 0, shortTitle: '' } } })
  assert.ok(errors.some((e) => e.startsWith('bad: game')))
  assert.ok(errors.some((e) => e.startsWith('bad: disc')))
  assert.ok(errors.some((e) => e.startsWith('bad: shortTitle')))
})

test('real manifest: catalogue and DS replacement src names never collide', () => {
  const srcs = Object.values(real.tracks).map((t) => t.src).filter((s): s is string => Boolean(s))
  assert.equal(new Set(srcs).size, srcs.length)
  for (const [id, entry] of Object.entries(real.tracks)) {
    if (entry.disc !== undefined && entry.src) {
      const expected = entry.audioProvenance ? `original/ds-${id.replaceAll('_', '-')}.` : `original/d${entry.disc}-${String(entry.number).padStart(2, '0')}-`
      assert.ok(entry.src.startsWith(expected), id)
    }
  }
  const keys = Object.values(real.tracks).filter((t) => t.src).map((t) => `${t.disc ?? 1}:${t.number}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('real manifest: every loop is measured (not auditioned), honest and only on runtime tracks', () => {
  let looped = 0
  for (const [id, entry] of Object.entries(real.tracks)) {
    if (entry.loop === null) {
      if (entry.src) assert.ok(entry.loopReason && entry.loopReason.length > 10, `${id}: a null loop needs a reason`)
      continue
    }
    looped++
    assert.ok(entry.src, `${id}: loops only on runtime tracks`)
    const raw = entry.loop as Record<string, unknown>
    const meta = parseLoopMetadata(raw)
    assert.ok(meta.region, `${id}: valid region`)
    assert.equal(meta.provenance, 'curated-analysis')
    assert.equal(meta.status, 'measured_not_auditioned', `${id}: status`)
    assert.ok(meta.method, `${id}: method`)
    assert.equal(meta.region.sampleRate, 44100)
    assert.ok(meta.confidence !== null && meta.confidence > 0 && meta.confidence <= 1, `${id}: confidence`)
    assert.match(String(raw.note), /Not an original DS loop point/)
    assert.match(String(raw.note), /not verified by listening/)
  }
  assert.ok(looped > 0)
})

test('real manifest: characters with a theme resolve to bgm tracks that exist as files', () => {
  const expectations: Record<string, string> = {
    miles_edgeworth: 'triumphant_return_miles_edgeworth',
    franziska_von_karma: 'triumphant_return_franziska_von_karma',
    larry_butz: 'larry_butz_when_something_smells_its_usually_me',
    pearl_fey: 'pearl_fey_with_pearly',
    diego_armando: 'godot_the_fragrance_of_darkness_that_is_coffee',
    godot: 'godot_the_fragrance_of_darkness_that_is_coffee',
    ema_skye: 'ema_skye_turnabout_sisters_2005',
    // existing profiles keep their defaults
    maya_fey: 'maya_fey_turnabout_sisters_2001',
    dick_gumshoe: 'dick_gumshoe_thats_detective_gumshoe_pal',
    mia_fey: 'maya_fey_turnabout_sisters_2001',
  }
  for (const [character, expected] of Object.entries(expectations)) {
    assert.equal(themeTrackFor(real, character), expected, character)
    assert.ok(bgmPool(real).includes(expected), `${expected} is in the bgm pool`)
    assert.ok(isSelectableTrack(real, expected))
  }
  // a character without a profile gets the default theme, never an error
  assert.equal(themeTrackFor(real, 'someone_new'), themeTrackFor(real, 'default'))
})

test('real manifest: per source group (PWAA zip, disc 2, disc 3) the installed files are all there or all absent', () => {
  const root = new URL('../public/assets/music/', import.meta.url)
  const groups = new Map<string, { id: string; src: string }[]>()
  for (const [id, entry] of Object.entries(real.tracks)) {
    if (entry.src) groups.set(String(entry.disc ?? 1), [...(groups.get(String(entry.disc ?? 1)) ?? []), { id, src: entry.src }])
  }
  for (const [group, items] of groups) {
    const present = items.filter((item) => existsSync(new URL(item.src, root)))
    if (present.length === 0) continue // that source was not installed (D-071: local-only OST), notice only
    assert.equal(present.length, items.length, `group ${group}: partially installed (${items.filter((i) => !present.includes(i)).map((i) => i.id).join(', ')})`)
  }
})
