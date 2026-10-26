import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { playSfx, SFX_EVENTS, SFX_NAMES, sfxEvent } from '../src/engine/sfx.ts'

const root = new URL('../public/assets/audio/', import.meta.url)
const audio = JSON.parse(readFileSync(new URL('audio.json', root), 'utf8'))

test('every semantic sfx name maps to an existing sound file', () => {
  assert.equal(SFX_NAMES.length, 11) // 8 original + shared angry / flabbergasted / encouragement (D-092)
  for (const name of SFX_NAMES) {
    const sound = audio.sounds[audio.events[SFX_EVENTS[name]]]
    assert.ok(sound, `${name} has no sound`)
    assert.ok(existsSync(new URL(sound.src, root)), `${name} -> ${sound.src} missing`)
    assert.ok(!/\s/.test(sound.src))
    const wav = readFileSync(new URL(sound.src, root))
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF', `${name} is not a RIFF WAV`)
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE', `${name} is not a WAVE file`)
  }
})

test('key semantic sounds have distinct intended runtime mappings', () => {
  const expected = {
    shock: 'effects/supershock.wav',
    surprise: 'effects/shock.wav',
    realization: 'effects/lightbulb.wav',
    comic: 'effects/badum.wav',
    emphasis: 'effects/deskslam.wav',
  }
  for (const [name, src] of Object.entries(expected)) {
    const sound = audio.sounds[audio.events[`sfx_${name}`]]
    assert.equal(sound.src, src)
  }
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length)
})

// SHA-256 of the requested cue `docs/sfx general/sfx-lightbulb.wav`. That source library is
// gitignored (local only), so the digest is pinned here and a clean checkout can still verify it.
const REQUESTED_LIGHTBULB_SHA256 = 'd21b1e310c0edb23c51d98e7fee649526d707118611a2d9870cdaa0222ac9821'

test('realization uses the exact requested lightbulb cue and preserves the older source', () => {
  const src = audio.sounds[audio.events.sfx_realization].src
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  assert.equal(digest(readFileSync(new URL(src, root))), REQUESTED_LIGHTBULB_SHA256)
  const requested = new URL('../../docs/sfx general/sfx-lightbulb.wav', import.meta.url)
  if (existsSync(requested)) assert.equal(digest(readFileSync(requested)), REQUESTED_LIGHTBULB_SHA256)
  assert.ok(existsSync(new URL('dialogue/realization/realization.wav', root)))
})

test('user_typing maps to the male blip', () => {
  assert.equal(audio.events.user_typing, 'blip_male')
})

test('phone loop uses the metadata-identified Phoenix ringtone and retains the answer/cut cue', () => {
  const ring = audio.sounds[audio.events.phone_ring_loop]
  assert.equal(ring.src, 'effects/phoenix_ringtone.mp3')
  const bytes = readFileSync(new URL(ring.src, root))
  assert.equal(bytes.toString('ascii', 0, 3), 'ID3')
  assert.ok(bytes.includes(Buffer.from('Ringtone (Phoenix Wright)')))
  assert.notEqual(audio.events.phone_ring_loop, audio.events.sfx_notification)
  assert.ok(ring.loop.startSeconds > 0 && ring.loop.endSeconds > ring.loop.startSeconds)
  assert.equal(audio.sounds[audio.events.phone_answer].src, 'effects/phone_cut.wav')
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
