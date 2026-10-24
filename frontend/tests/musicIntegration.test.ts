// Lead integration: persisted music settings → one engine request, and stored-settings hygiene.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { musicRequestFor, type MusicSettings } from '../src/music/musicRuntime.ts'
import { DEFAULT_RADIO_VIDEO_ID } from '../src/music/radio/presets.ts'
import type { SoundtrackManifest } from '../src/music/soundtrack.ts'
import { readMusicSettings } from '../src/settings/settings.ts'

const soundtrack: SoundtrackManifest = JSON.parse(
  readFileSync(new URL('../public/assets/music/soundtrack.json', import.meta.url), 'utf8'),
)

const base: MusicSettings = {
  musicSource: 'off', musicVolume: 0.5, musicMuted: false, originalTrackId: '', importedTrackId: '', radioVideoId: '',
}

test('off maps to no source at all', () => {
  assert.deepEqual(musicRequestFor(base, soundtrack), { kind: 'off' })
})

test('original uses the chosen track, else the soundtrack profile default (data, not code)', () => {
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'original' }, soundtrack),
    { kind: 'original', trackId: soundtrack.profiles.default.defaultTrack })
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'original', originalTrackId: 'suspense' }, soundtrack),
    { kind: 'original', trackId: 'suspense' })
  // Excluded or unknown ids never play; the profile default is used instead.
  for (const bad of ['victory_our_first_win', 'nope']) {
    assert.deepEqual(musicRequestFor({ ...base, musicSource: 'original', originalTrackId: bad }, soundtrack),
      { kind: 'original', trackId: soundtrack.profiles.default.defaultTrack })
  }
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'original' }, null), { kind: 'original', trackId: null })
})

test('imported waits for a choice; radio falls back to the configurable preset', () => {
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'imported' }, soundtrack), { kind: 'imported', trackId: null })
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'imported', importedTrackId: 'abc' }, soundtrack),
    { kind: 'imported', trackId: 'abc' })
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'radio' }, soundtrack), { kind: 'radio', trackId: DEFAULT_RADIO_VIDEO_ID })
  assert.deepEqual(musicRequestFor({ ...base, musicSource: 'radio', radioVideoId: 'M7lc1UVf-VE' }, soundtrack),
    { kind: 'radio', trackId: 'M7lc1UVf-VE' })
})

test('stored music settings are sanitised: unknown sources, out-of-range volume and unsafe ids are dropped', () => {
  assert.deepEqual(readMusicSettings({
    musicSource: 'spotify', musicVolume: 7, musicMuted: 'yes',
    originalTrackId: '../../etc', importedTrackId: 'a b', radioVideoId: '<script>',
  }), base)
  assert.deepEqual(readMusicSettings({
    musicSource: 'radio', musicVolume: 0.25, musicMuted: true,
    originalTrackId: 'suspense', importedTrackId: '37b00b43358d4d14ac26adcad1a81642', radioVideoId: 'M7lc1UVf-VE',
  }), {
    musicSource: 'radio', musicVolume: 0.25, musicMuted: true,
    originalTrackId: 'suspense', importedTrackId: '37b00b43358d4d14ac26adcad1a81642', radioVideoId: 'M7lc1UVf-VE',
  })
})

test('stored selection for the retired Lofi Girl stream resets to the current preset', () => {
  assert.equal(readMusicSettings({ radioVideoId: 'jfKfPfyJRdk' }).radioVideoId, '')
  assert.equal(DEFAULT_RADIO_VIDEO_ID, 'EWrX250Zhko')
})
