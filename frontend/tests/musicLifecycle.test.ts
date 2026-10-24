// BGM lifecycle: menus are silent, a conversation starts its character's music, leaving stops it,
// and re-syncing never duplicates the source.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MusicEngine } from '../src/music/MusicEngine.ts'
import { musicRequestFor, syncMusic, type MusicContext, type MusicSettings } from '../src/music/musicRuntime.ts'
import type { SoundtrackManifest } from '../src/music/soundtrack.ts'
import type { MusicSource, MusicSourceKind, SourceState } from '../src/music/types.ts'

const soundtrack: SoundtrackManifest = JSON.parse(
  readFileSync(new URL('../public/assets/music/soundtrack.json', import.meta.url), 'utf8'),
)
const on: MusicSettings = {
  musicSource: 'original', musicVolume: 0.4, musicMuted: false, originalTrackId: '', importedTrackId: '', radioVideoId: '',
}
const menu: MusicContext = { scene: 'menu' }
const maya: MusicContext = { scene: 'conversation', characterId: 'maya_fey' }

function fake(kind: MusicSourceKind, log: string[]): MusicSource {
  let state: SourceState = { status: 'idle', trackId: null, title: null, error: null }
  const listeners = new Set<(s: SourceState) => void>()
  const set = (patch: Partial<SourceState>) => {
    state = { ...state, ...patch }
    for (const l of [...listeners]) l(state)
  }
  return {
    kind,
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    async start(trackId) {
      log.push(`start:${trackId}`)
      set({ status: 'playing', trackId, title: trackId })
    },
    pause() {},
    resume() {},
    async stop() {
      log.push('stop')
      set({ status: 'idle', trackId: null, title: null })
    },
    setVolume() {},
    dispose() {},
  }
}

function setup() {
  const log: string[] = []
  const engine = new MusicEngine({ fadeInMs: 0, fadeOutMs: 0 })
  engine.registerSource(fake('original', log))
  return { engine, log }
}

test('menus are silent; a conversation uses the character profile, else default', () => {
  assert.deepEqual(musicRequestFor(on, soundtrack, menu), { kind: 'off' })
  assert.deepEqual(musicRequestFor({ ...on, musicSource: 'radio' }, soundtrack, menu), { kind: 'off' })
  assert.deepEqual(musicRequestFor(on, soundtrack, maya), { kind: 'original', trackId: 'maya_fey_turnabout_sisters_2001' })
  const other: MusicContext = { scene: 'conversation', characterId: 'someone_new' }
  assert.deepEqual(musicRequestFor(on, soundtrack, other), { kind: 'original', trackId: soundtrack.profiles.default.defaultTrack })
  assert.deepEqual(musicRequestFor({ ...on, originalTrackId: 'suspense' }, soundtrack, maya), { kind: 'original', trackId: 'suspense' })
  assert.deepEqual(musicRequestFor({ ...on, musicSource: 'off' }, soundtrack, maya), { kind: 'off' })
})

test('a menu soundtrack profile, if one is ever added, plays only on menus', () => {
  const withMenu: SoundtrackManifest = { ...soundtrack, profiles: { ...soundtrack.profiles, menu: { defaultTrack: 'suspense', alternatives: [] } } }
  assert.deepEqual(musicRequestFor(on, withMenu, menu), { kind: 'original', trackId: 'suspense' })
  assert.deepEqual(musicRequestFor(on, withMenu, maya), { kind: 'original', trackId: 'maya_fey_turnabout_sisters_2001' })
})

test('an explicit audition plays outside a conversation', () => {
  assert.equal(musicRequestFor({ ...on, musicSource: 'radio' }, soundtrack, { scene: 'menu', audition: true }).kind, 'radio')
})

test('lifecycle: silent menu, starts on enter, no duplicate on re-sync, stops on leave', async () => {
  const { engine, log } = setup()
  await syncMusic(engine, on, soundtrack, menu)
  assert.deepEqual(log, [])
  assert.equal(engine.getState().status, 'idle')

  await syncMusic(engine, on, soundtrack, maya)
  assert.equal(engine.getState().status, 'playing')
  assert.deepEqual(log, ['start:maya_fey_turnabout_sisters_2001'])

  // Same conversation re-synced (settings changed / re-entered): same track, no restart.
  await syncMusic(engine, { ...on, musicVolume: 0.9 }, soundtrack, maya)
  await syncMusic(engine, on, soundtrack, { scene: 'conversation', characterId: 'maya_fey' })
  assert.deepEqual(log, ['start:maya_fey_turnabout_sisters_2001'])
  assert.equal(engine.getState().volume, 0.4)

  await syncMusic(engine, on, soundtrack, menu)
  assert.equal(engine.getState().status, 'idle')
  assert.equal(log.at(-1), 'stop')
})
