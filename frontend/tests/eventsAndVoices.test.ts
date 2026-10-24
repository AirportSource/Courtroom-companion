import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseInboxEvents } from '../src/events/eventInbox.ts'
import { allShouts, parseVoices, pickShout, randomShout, shoutSound } from '../src/engine/voices.ts'

const performance = {
  characterId: 'mia_fey',
  segments: [{ text: 'Objection!', emotion: 'serious', animation: 'serious_front', intensity: 0.8, reaction: null, gesture: null, sfx: null, estimatedMs: 900 }],
  settle: { emotion: 'serious', animation: 'serious_front' },
  notes: [],
}

test('inbox events are validated and malformed ones dropped', () => {
  const parsed = parseInboxEvents({
    cursor: 7,
    events: [
      { id: 6, type: 'tests_failed', source: 'claude-code', project: 'app', attention: false, exclamation: 'objection', performance },
      { id: 7, type: 'reminder_due', attention: true, exclamation: 'explode', performance },
      { id: 'x', type: 'task_finished', performance },
      { id: 8, type: 'task_finished', performance: { segments: [] } },
    ],
  })
  assert.equal(parsed.cursor, 7)
  assert.deepEqual(parsed.events.map((e) => [e.id, e.exclamation, e.attention]), [[6, 'objection', false], [7, null, true]])
  assert.equal(parsed.events[0].performance.segments[0].text, 'Objection!')
  assert.deepEqual(parseInboxEvents(null), { cursor: 0, events: [] })
})

test('voice catalog keeps valid entries, falls back across languages and picks among speakers', () => {
  const voices = parseVoices({
    objection: { ja: { mia: 'v_ja_mia', edgeworth: 'v_ja_edge', bad: 'missing' }, en: { phoenix: 'v_en_phoenix' } },
    hold_it: { 'x-y': { mia: 'v_ja_mia' } },
    explode: { en: { mia: 'v_en_phoenix' } },
  }, new Set(['v_ja_mia', 'v_ja_edge', 'v_en_phoenix']))
  assert.deepEqual(voices, { objection: { ja: { mia: 'v_ja_mia', edgeworth: 'v_ja_edge' }, en: { phoenix: 'v_en_phoenix' } } })
  assert.equal(shoutSound('objection', 'ja', 'mia', voices), 'v_ja_mia')
  assert.equal(shoutSound('objection', 'ja', 'phoenix', voices), 'v_en_phoenix') // other language as fallback
  assert.equal(shoutSound('take_that', 'ja', 'mia', voices), null)
  assert.deepEqual(randomShout('objection', 'ja', ['phoenix', 'mia', 'edgeworth'], () => 0.99, voices), { speaker: 'edgeworth', sound: 'v_ja_edge' })
  assert.equal(randomShout('take_that', 'ja', ['mia'], Math.random, voices), null)
})

test('the shipped audio manifest declares the owner-labelled shouts', () => {
  const audio = JSON.parse(readFileSync(new URL('../public/assets/audio/audio.json', import.meta.url), 'utf8'))
  const voices = parseVoices(audio.voices, new Set(Object.keys(audio.sounds)))
  for (const speaker of ['phoenix', 'mia', 'edgeworth']) assert.ok(voices.objection?.en?.[speaker], speaker)
  assert.ok(voices.objection?.ja?.mia && voices.objection?.ja?.edgeworth)
  for (const event of ['exclamation_objection', 'exclamation_hold_it', 'exclamation_take_that']) assert.ok(audio.events[event], event)
})

test('title draw: every voice of the phrase, never the same twice in a row', () => {
  const voices = { objection: { en: { phoenix: 'a', mia: 'b' }, ja: { mia: 'c' } } }
  assert.deepEqual(allShouts('objection', voices), ['a', 'b', 'c'])
  for (let i = 0; i < 20; i++) assert.notEqual(pickShout(['a', 'b', 'c'], 'b'), 'b')
  assert.equal(pickShout(['a'], 'a'), 'a')
  assert.equal(pickShout([], null), null)
  assert.equal(pickShout(['a', 'b', 'c'], 'a', () => 0.99), 'c')
})

test('Japanese shouts get the Japanese bubble when it exists', async () => {
  const { bubbleFor, isJapaneseVoice } = await import('../src/events/exclamations.ts')
  const en = { url: 'en.png', width: 256, height: 192 }
  const ja = { url: 'ja.png', width: 256, height: 192 }
  assert.equal(bubbleFor({ objection: en, objection_ja: ja }, 'objection', true), ja)
  assert.equal(bubbleFor({ objection: en, objection_ja: ja }, 'objection', false), en)
  assert.equal(bubbleFor({ hold_it: en }, 'hold_it', true), en) // no Japanese bubble yet: English one
  assert.equal(bubbleFor({}, 'take_that', true), null)
  assert.equal(isJapaneseVoice('voice_ja_phoenix_objection'), true)
  assert.equal(isJapaneseVoice('voice_en_mia_objection'), false)
  assert.equal(isJapaneseVoice(null), false)
})
