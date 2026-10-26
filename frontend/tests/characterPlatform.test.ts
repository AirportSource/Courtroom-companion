import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isListable, listableCharacters, readGroup, readReadiness } from '../src/engine/characterReadiness.ts'
import type { CharacterSummary } from '../src/engine/manifestTypes.ts'
import { parseChatResponse } from '../src/engine/performance.ts'
import { isKnownSfx, playSfx, registerSignatureSfx, SFX_EVENTS, sfxEvent } from '../src/engine/sfx.ts'

const root = new URL('../public/assets/', import.meta.url)
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))

const summary = (id: string, readiness: CharacterSummary['readiness'], group?: string): CharacterSummary =>
  ({ id, displayName: id, names: {}, manifestUrl: `x/${id}`, previewUrl: null, readiness, group })

test('readiness: unknown or missing values are conservative (partial)', () => {
  assert.equal(readReadiness('ready'), 'ready')
  assert.equal(readReadiness('asset-only'), 'asset-only')
  for (const raw of [undefined, null, 'READY', 'done', 3]) assert.equal(readReadiness(raw), 'partial')
  assert.equal(readGroup('aa1'), 'aa1')
  assert.equal(readGroup('AA 1'), undefined)
})

test('production lists ready only; development adds partial; asset-only is never listed', () => {
  const all = [summary('a', 'ready'), summary('b', 'partial'), summary('c', 'asset-only'), summary('d', 'ready')]
  assert.deepEqual(listableCharacters(all, false).map((c) => c.id), ['a', 'd'])
  assert.deepEqual(listableCharacters(all, true).map((c) => c.id), ['a', 'b', 'd'])
  assert.equal(isListable('asset-only', true), false)
})

test('many characters stay in registered order, grouped by game, ungrouped last', () => {
  const many = Array.from({ length: 12 }, (_, i) => summary(`c${i}`, 'ready', i % 3 === 0 ? 'aa2' : i % 3 === 1 ? 'aa1' : undefined))
  const ids = listableCharacters(many, false).map((c) => c.id)
  assert.equal(ids.length, 12)
  assert.deepEqual(ids.slice(0, 4), ['c0', 'c3', 'c6', 'c9'])  // first group seen is aa2
  assert.deepEqual(ids.slice(4, 8), ['c1', 'c4', 'c7', 'c10'])
  assert.deepEqual(ids.slice(8), ['c2', 'c5', 'c8', 'c11'])
})

test('the registered packs are listed correctly and every ready pack is complete', () => {
  const index = json('characters/index.json').characters as Record<string, string>
  const ids = Object.keys(index)
  assert.ok(ids.length >= 3)
  for (const [id, path] of Object.entries(index)) {
    const manifest = json(`characters/${path}`)
    const folder = new URL(`characters/${path.replace(/[^/]+$/, '')}`, root)
    assert.equal(manifest.id, id)
    if (manifest.readiness === 'ready') {
      assert.ok(existsSync(new URL('personality.md', folder)), `${id}: ready needs personality.md`)
      assert.ok(existsSync(new URL('performance.json', folder)), `${id}: ready needs performance.json`)
    }
  }
  for (const id of ['maya_fey', 'dick_gumshoe', 'mia_fey']) {
    assert.equal(json(`characters/${index[id]}`).readiness, 'ready')
  }
})

test('signature sounds: registered from audio events, not hard-coded', () => {
  const body = (sfx: unknown) => ({ performance: { characterId: 'c', segments: [
    { text: 'Hmph.', emotion: 'angry', animation: 'a', intensity: 0.9, reaction: null, gesture: null, sfx, estimatedMs: 0 }], settle: {}, notes: [] } })
  const sfxOf = (value: unknown) => parseChatResponse(body(value)).performance.segments[0].sfx
  try {
    registerSignatureSfx([])
    assert.equal(sfxOf('whip'), null)               // not declared by any audio event yet
    assert.deepEqual(registerSignatureSfx(['sfx_whip', 'sfx_shock', 'sfx_Bad', 'sfx_', 'menu_cursor', 'sfx_a']), ['whip'])
    assert.equal(sfxOf('whip'), 'whip')
    assert.equal(sfxOf('shock'), 'shock')           // global names always work
    assert.equal(sfxOf('../whip'), null)
    assert.equal(sfxOf('explosion'), null)
    assert.equal(sfxEvent('whip'), 'sfx_whip')
    assert.equal(SFX_EVENTS.whip, 'sfx_whip')
    assert.ok(isKnownSfx('whip') && !isKnownSfx('toString'))
    const played: string[] = []
    const player = { playEvent: (event: string) => { played.push(event); return true } }
    assert.equal(playSfx('whip', 0.8, false, player), true)
    assert.deepEqual(played, ['sfx_whip'])
    registerSignatureSfx([])                        // a registry reload forgets removed sounds
    assert.equal(sfxEvent('whip'), null)
    assert.equal(sfxEvent('shock'), 'sfx_shock')
  } finally {
    registerSignatureSfx([])
  }
})

test('the whip is performed with separate whip and whack cues mapped by audio.json (D-091)', () => {
  const audio = json('audio/audio.json')
  assert.equal(audio.sounds[audio.events.whip_swing].src, 'effects/whip.wav')
  assert.equal(audio.sounds[audio.events.whip_impact].src, 'dialogue/shock/whack.wav')
  assert.equal(audio.events.sfx_whip, undefined) // the old compound cue is no longer a semantic sound
  for (const src of ['effects/whip.wav', 'dialogue/shock/whack.wav']) {
    const wav = readFileSync(new URL(`audio/${src}`, root))
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  }
})

test('every declared signature sound has an audio event and does not shadow a global name', () => {
  const audio = json('audio/audio.json')
  const index = json('characters/index.json').characters as Record<string, string>
  for (const path of Object.values(index)) {
    const perfUrl = new URL(`characters/${path.replace(/[^/]+$/, '')}performance.json`, root)
    if (!existsSync(perfUrl)) continue
    const manifest = json(`characters/${path}`)
    for (const sig of JSON.parse(readFileSync(perfUrl, 'utf8')).sfx?.signature ?? []) {
      if (sig.performs) {
        // Performed signatures sound through their reaction's effect cues.
        const cues = manifest.reactions[sig.performs].effect.cues as { event: string }[]
        assert.ok(cues.length > 0 && cues.every((cue) => audio.events[cue.event]), `${sig.id} cues`)
      } else {
        assert.ok(audio.events[`sfx_${sig.id}`], `${sig.id} has no audio event`)
      }
      assert.ok(!['surprise', 'shock', 'realization', 'comic', 'emphasis', 'tension', 'notification', 'soft_transition'].includes(sig.id))
    }
  }
})
