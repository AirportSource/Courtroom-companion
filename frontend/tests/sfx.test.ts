import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { playSfx, SFX_EVENTS, SFX_NAMES, sfxEvent } from '../src/engine/sfx.ts'

const root = new URL('../public/assets/audio/', import.meta.url)
const audio = JSON.parse(readFileSync(new URL('audio.json', root), 'utf8'))

test('every semantic sfx name maps to an existing sound file', () => {
  assert.equal(SFX_NAMES.length, 8)
  for (const name of SFX_NAMES) {
    const sound = audio.sounds[audio.events[SFX_EVENTS[name]]]
    assert.ok(sound, `${name} has no sound`)
    assert.ok(existsSync(new URL(sound.src, root)), `${name} -> ${sound.src} missing`)
    assert.ok(!/\s/.test(sound.src))
  }
})

test('user_typing maps to the male blip', () => {
  assert.equal(audio.events.user_typing, 'blip_male')
})

test('unknown names are ignored, mute and zero volume are silent', () => {
  const played: string[] = []
  const player = {
    playEvent: (event: string) => {
      played.push(event)
      return true
    },
  }
  assert.equal(sfxEvent('nope'), null)
  assert.equal(sfxEvent('toString'), null)
  assert.equal(playSfx('nope', 1, false, player), false)
  assert.equal(playSfx('shock', 1, true, player), false)
  assert.equal(playSfx('shock', 0, false, player), false)
  assert.deepEqual(played, [])
  assert.equal(playSfx('shock', 0.6, false, player), true)
  assert.deepEqual(played, ['sfx_shock'])
})
