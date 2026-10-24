// Engine unit tests: Node's built-in test runner, no extra dependencies (npm test).
// They exercise the pure engine logic against the real manifests in public/assets.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveClip, resolveEmotion } from '../src/engine/characterResolver.ts'
import type { AnimationClip, CharacterManifest, ClipManifest, LoadedCharacter } from '../src/engine/manifestTypes.ts'
import { MENU_SOUNDS } from '../src/engine/menuSounds.ts'
import { frameDurationMs } from '../src/engine/useClipPlayback.ts'
import { isBlipChar } from '../src/engine/useBlips.ts'
import { pauseAfter, typewriterStateOf } from '../src/engine/useTypewriter.ts'

const assets = new URL('../public/assets/', import.meta.url)
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, assets), 'utf8'))

const manifest: CharacterManifest = readJson('characters/maya/character.json')

function toClip(key: string, raw: ClipManifest, canvas: { width: number; height: number }): AnimationClip {
  return {
    key,
    fps: raw.fps,
    loop: raw.loop,
    canvas,
    aligned: true,
    holdJitterMs: raw.holdJitterMs ?? 0,
    frames: raw.frames.map((path, i) => ({
      path,
      url: path,
      width: 1,
      height: 1,
      x: raw.offsets?.[i]?.[0] ?? 0,
      y: raw.offsets?.[i]?.[1] ?? 0,
      durationMs: raw.frameDurations?.[i],
    })),
  }
}

function loadedFrom(m: CharacterManifest): LoadedCharacter {
  const animations: LoadedCharacter['animations'] = {}
  for (const [id, a] of Object.entries(m.animations)) {
    const canvas = a.canvas ?? { width: 1, height: 1 }
    animations[id] = {
      id,
      idle: a.idle && toClip(`${id}.idle`, a.idle, canvas),
      talking: a.talking && toClip(`${id}.talking`, a.talking, canvas),
    }
  }
  const reactions: LoadedCharacter['reactions'] = {}
  for (const [id, r] of Object.entries(m.reactions ?? {})) {
    reactions[id] = { ...toClip(`reaction:${id}`, r, r.canvas ?? { width: 1, height: 1 }), loop: false }
  }
  return {
    id: m.id,
    displayName: m.displayName,
    anchor: { horizontal: 'center', vertical: 'bottom' },
    render: { scale: 1, offsetX: 0, offsetY: 0 },
    voice: m.voice ?? {},
    defaultEmotion: m.defaultEmotion,
    fallbackEmotion: m.fallbackEmotion,
    animations,
    reactions,
    emotions: m.emotions,
    warnings: [],
  }
}

const maya = loadedFrom(manifest)

test('every emotion resolves to its own animation in both modes without fallbacks', () => {
  for (const [emotion, binding] of Object.entries(manifest.emotions)) {
    for (const mode of ['idle', 'talking'] as const) {
      const resolved = resolveClip(maya, emotion, mode, false)
      assert.ok(resolved, emotion)
      assert.equal(resolved.animationId, binding.animation)
      assert.equal(resolved.variant, mode)
      assert.deepEqual(resolved.fallbacks, [])
    }
  }
})

test('reaction plays first, never loops, then settles to the stable animation', () => {
  const reacting = resolveClip(maya, 'surprised', 'talking', true)
  assert.equal(reacting?.variant, 'reaction')
  assert.equal(reacting?.clip.loop, false)
  const settled = resolveClip(maya, 'surprised', 'idle', false)
  assert.equal(settled?.variant, 'idle')
  assert.equal(settled?.animationId, manifest.emotions.surprised.animation)
})

test('fallbacks: unknown emotion, missing variant, missing animation, empty character', () => {
  assert.equal(resolveEmotion(maya, 'nonexistent'), manifest.fallbackEmotion)
  const noTalking = structuredClone(manifest)
  delete noTalking.animations.thinking_side.talking
  const t = resolveClip(loadedFrom(noTalking), 'thinking', 'talking', false)
  assert.equal(t?.variant, 'idle')
  assert.match(t?.fallbacks.join() ?? '', /talking unavailable/)
  const noSad = structuredClone(manifest)
  delete noSad.animations.sad_crying
  assert.equal(resolveClip(loadedFrom(noSad), 'sad', 'idle', false)?.animationId, manifest.emotions[manifest.fallbackEmotion].animation)
  assert.equal(resolveClip({ ...maya, animations: {}, reactions: {} }, 'neutral', 'idle', true), null)
})

test('every frame sits inside its canvas, bottom-aligned (no baseline jitter)', () => {
  for (const [id, a] of Object.entries(manifest.animations)) {
    for (const clip of [a.idle, a.talking]) {
      assert.ok(clip && a.canvas && clip.offsets, id)
      assert.equal(clip.offsets.length, clip.frames.length, id)
    }
  }
})

test('typewriter states', () => {
  assert.equal(typewriterStateOf(0, 10, false), 'waiting')
  assert.equal(typewriterStateOf(0, 10, true), 'revealing')
  assert.equal(typewriterStateOf(5, 10, true), 'revealing')
  assert.equal(typewriterStateOf(10, 10, true), 'complete')
  assert.equal(typewriterStateOf(10, 10, false), 'complete')
  assert.equal(typewriterStateOf(0, 0, true), 'complete')
})

test('punctuation pauses only at word ends', () => {
  const pauses = (t: string) => [...t].map((_, i) => pauseAfter(t, i))
  assert.deepEqual(pauses('Hey! Can'), [0, 0, 0, 350, 0, 0, 0, 0])
  assert.deepEqual(pauses('Hmm... ok'), [0, 0, 0, 120, 120, 350, 0, 0, 0])
  assert.deepEqual(pauses('that?! No'), [0, 0, 0, 0, 0, 350, 0, 0, 0])
  assert.deepEqual(pauses('Aw, ok'), [0, 0, 180, 0, 0, 0])
  assert.equal(pauseAfter('W-Wait', 1), 0)
})

test('blips: letters only, never whitespace or punctuation', () => {
  for (const c of ['a', 'Z', '7', 'é']) assert.equal(isBlipChar(c), true, c)
  for (const c of [' ', '\n', '.', ',', '!', '?', '…', '’', '-', '(', ')']) assert.equal(isBlipChar(c), false, JSON.stringify(c))
})

test('every logical menu sound is mapped to an existing sound', () => {
  const audio = readJson('audio/audio.json')
  for (const event of MENU_SOUNDS) {
    const soundId = audio.events?.[event]
    assert.ok(soundId, `${event} unmapped`)
    assert.ok(audio.sounds[soundId], `${event} → unknown sound ${soundId}`)
  }
  assert.equal(audio.sounds[audio.events.menu_page].src, 'menu_ui/pageturn.wav')
})

test('idle blinks: eyes-open frame holds for seconds, blink frames are quick', () => {
  for (const [id, a] of Object.entries(maya.animations)) {
    const idle = a.idle
    assert.ok(idle, id)
    const hold = frameDurationMs(idle, 0, () => 0)
    const holdMax = frameDurationMs(idle, 0, () => 1)
    assert.ok(hold >= 2000, `${id}: open-eyes hold ${hold}ms`)
    assert.ok(holdMax > hold, `${id}: hold has random variation`)
    for (let i = 1; i < idle.frames.length; i++) assert.ok(frameDurationMs(idle, i) <= 120, `${id}: blink frame ${i}`)
  }
  // Talking clips keep their fps timing.
  const talking = maya.animations.neutral_front.talking
  assert.ok(talking)
  assert.equal(frameDurationMs(talking, 0, () => 1), 1000 / talking.fps)
})
