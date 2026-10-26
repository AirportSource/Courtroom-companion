import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, test } from 'node:test'
import { loadCharacter } from '../src/engine/manifestLoader.ts'
import { selectPresentation } from '../src/engine/presentationContext.ts'
import { resolveClip, resolveReactionId } from '../src/engine/characterResolver.ts'
import { waitingPerformance } from '../src/engine/presentation.ts'

const originalFetch = globalThis.fetch
const originalImage = globalThis.Image
globalThis.Image = class {
  src = ''
  naturalWidth = 1
  naturalHeight = 1
  decode() { return Promise.resolve() }
} as unknown as typeof Image
after(() => { globalThis.fetch = originalFetch; globalThis.Image = originalImage })

const clip = (path: string) => ({ fps: 6, loop: true, frames: [path] })
const animation = (path: string) => ({ idle: clip(path), talking: clip(path) })
const fixture = {
  id: 'same_character', displayName: 'Same Character', schemaVersion: 1,
  defaultEmotion: 'neutral', fallbackEmotion: 'neutral', defaultPresentation: 'conversation',
  animations: { neutral: animation('legacy.png') }, emotions: { neutral: { animation: 'neutral', reaction: 'shared' } },
  reactions: { shared: { ...clip('shared.png'), loop: false } },
  presentationGroups: {
    conversation: { animations: { neutral: animation('discussion.png') } },
    courtroom: { animations: { neutral: animation('court.png') }, reactions: { shared: { ...clip('court-reaction.png'), loop: false } } },
  },
}

async function load(raw: unknown) {
  globalThis.fetch = (async () => ({ ok: true, json: async () => raw })) as typeof fetch
  return loadCharacter('https://local.test/assets/characters/example/character.json')
}
const framePath = (character: Awaited<ReturnType<typeof load>>) => resolveClip(character, 'neutral', 'idle', false)?.clip.frames[0].path

test('explicit context selects independent groups while character identity stays stable', async () => {
  const character = await load(fixture)
  assert.equal(framePath(selectPresentation(character, 'conversation')), 'discussion.png')
  assert.equal(framePath(selectPresentation(character, 'courtroom')), 'court.png')
  assert.equal(selectPresentation(character, 'conversation').id, character.id)
  assert.equal(selectPresentation(character, 'courtroom').id, character.id)
  assert.equal(framePath(character), 'legacy.png')
})

test('missing context uses declared default, then legacy when no default exists', async () => {
  const character = await load(fixture)
  assert.equal(framePath(selectPresentation(character, 'investigation')), 'discussion.png')
  assert.equal(framePath(selectPresentation(character)), 'discussion.png')
  const legacy = await load({ ...fixture, defaultPresentation: undefined, presentationGroups: undefined })
  assert.equal(selectPresentation(legacy, 'courtroom'), legacy)
  assert.equal(framePath(legacy), 'legacy.png')
})

test('active reaction wins, otherwise shared reactions remain available', async () => {
  const character = await load(fixture)
  for (const [context, expected] of [['conversation', 'shared.png'], ['courtroom', 'court-reaction.png']]) {
    const view = selectPresentation(character, context)
    assert.equal(resolveReactionId(view, 'neutral'), 'shared')
    assert.equal(resolveClip(view, 'neutral', 'idle', true)?.clip.frames[0].path, expected)
  }
})

test('group clip keys differ so switching presentation restarts deterministic playback', async () => {
  const character = await load(fixture)
  const discussion = resolveClip(selectPresentation(character, 'conversation'), 'neutral', 'idle', false)
  const courtroom = resolveClip(selectPresentation(character, 'courtroom'), 'neutral', 'idle', false)
  assert.notEqual(discussion?.clip.key, courtroom?.clip.key)
})

test('unavailable director pose falls back within the active group without court leakage', async () => {
  const character = selectPresentation(await load(fixture), 'conversation')
  const resolved = resolveClip(character, 'neutral', 'talking', false, { animation: 'court_only', reaction: null })
  assert.equal(resolved?.clip.frames[0].path, 'discussion.png')
  assert.ok(resolved?.fallbacks.length)
  assert.equal(waitingPerformance(character).animation, 'neutral')
})

test('malformed groups are ignored and legacy presentation remains playable', async () => {
  const character = await load({ ...fixture, defaultPresentation: 'broken', presentationGroups: { broken: { animations: {} } } })
  assert.equal(framePath(selectPresentation(character, 'broken')), 'legacy.png')
  assert.ok(character.warnings.some((warning) => warning.includes('group dropped')))
})

test('group placement and waiting pose override presentation without changing voice or names', async () => {
  const character = await load({ ...fixture, voice: { blip: 'female' }, presentationGroups: {
    conversation: {
      animations: { neutral: animation('discussion.png'), thinking: animation('thinking.png') },
      render: { offsetX: 7 }, waiting: { emotion: 'neutral', animation: 'thinking' },
    },
  } })
  const view = selectPresentation(character, 'conversation')
  assert.deepEqual(waitingPerformance(view), { emotion: 'neutral', animation: 'thinking' })
  assert.equal(view.render.offsetX, 7)
  assert.equal(view.voice.blip, 'female')
  assert.equal(view.names, character.names)
})

const pack = (folder: string) => JSON.parse(readFileSync(new URL(`../public/assets/characters/${folder}/character.json`, import.meta.url), 'utf8'))

test('Maya legacy conversation and courtroom selections preserve exactly the same pack', async () => {
  const maya = await load(pack('maya'))
  assert.equal(selectPresentation(maya, 'conversation'), maya)
  assert.equal(selectPresentation(maya, 'courtroom'), maya)
})

for (const folder of ['edgeworth', 'franziska']) {
  test(`${folder} discussion and courtroom frames resolve separately with the same identity`, async () => {
    const raw = pack(folder)
    assert.equal(raw.defaultPresentation, 'conversation')
    const character = await load(raw)
    const discussion = selectPresentation(character, 'conversation')
    const courtroom = selectPresentation(character, 'courtroom')
    const resolve = (view: typeof character) => resolveClip(view, view.defaultEmotion, 'idle', false)?.clip.frames[0].path
    assert.equal(discussion.id, courtroom.id)
    assert.notEqual(resolve(discussion), resolve(courtroom))
    const expected = raw.presentationGroups.conversation.animations[
      raw.presentationGroups.conversation.emotions?.[discussion.defaultEmotion]?.animation
        ?? raw.emotions[discussion.defaultEmotion].animation].idle.frames[0]
    assert.equal(resolve(discussion), expected)
    assert.ok(resolveClip(discussion, discussion.defaultEmotion, 'talking', false))
  })
}

test('Maya → Edgeworth → Franziska → Maya leaves identity and presentation isolated', async () => {
  const characters = await Promise.all(['maya', 'edgeworth', 'franziska'].map((folder) => load(pack(folder))))
  const before = resolveClip(characters[0], characters[0].defaultEmotion, 'idle', false)?.clip
  for (const character of [characters[0], characters[1], characters[2], characters[0]]) {
    const view = selectPresentation(character, 'conversation')
    assert.equal(view.id, character.id)
    assert.ok(resolveClip(view, view.defaultEmotion, 'idle', false))
  }
  assert.equal(resolveClip(characters[0], characters[0].defaultEmotion, 'idle', false)?.clip, before)
})
