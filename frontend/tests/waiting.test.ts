import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveClip } from '../src/engine/characterResolver.ts'
import type { CharacterManifest, LoadedCharacter } from '../src/engine/manifestTypes.ts'
import {
  nextPhase,
  presentationState,
  readWaiting,
  waitingOverride,
  waitingPerformance,
  type Phase,
  type PhaseEvent,
} from '../src/engine/presentation.ts'

const manifest: CharacterManifest = JSON.parse(
  readFileSync(new URL('../public/assets/characters/maya/character.json', import.meta.url), 'utf8'),
)
const clip = (key: string) => ({ key, fps: 1, loop: true, canvas: { width: 1, height: 1 }, aligned: true, holdJitterMs: 0, frames: [] })
function loaded(waiting?: LoadedCharacter['waiting']): LoadedCharacter {
  const animations = Object.fromEntries(Object.keys(manifest.animations).map((id) => [id, { id, idle: clip(id) }]))
  return {
    id: 'x',
    displayName: 'X',
    anchor: { horizontal: 'center', vertical: 'bottom' },
    render: { scale: 1, offsetX: 0, offsetY: 0 },
    voice: {},
    defaultEmotion: manifest.defaultEmotion,
    fallbackEmotion: manifest.fallbackEmotion,
    animations,
    reactions: {},
    emotions: manifest.emotions,
    waiting,
    warnings: [],
  }
}

test('maya manifest declares a thinking waiting pose that exists', () => {
  assert.deepEqual(manifest.waiting, { emotion: 'thinking', animation: 'thinking_side' })
  const parsed = readWaiting(manifest.waiting, manifest.emotions, manifest.animations, manifest.defaultEmotion)
  assert.deepEqual(parsed, { emotion: 'thinking', animation: 'thinking_side' })
})

test('waiting parsing falls back safely', () => {
  const read = (raw: unknown) => readWaiting(raw, manifest.emotions, manifest.animations, 'neutral')
  assert.equal(read(undefined), null)
  assert.equal(read('x'), null)
  assert.deepEqual(read({ emotion: 'nope', animation: 'nope' }), { emotion: 'neutral', animation: 'neutral_front' })
  assert.deepEqual(read({ emotion: 'sad' }), { emotion: 'sad', animation: 'sad_crying' })
})

test('missing waiting block falls back to the default emotion', () => {
  assert.deepEqual(waitingPerformance(loaded()), { emotion: 'neutral', animation: 'neutral_front' })
})

test('waiting resolves to a looping idle clip with no reaction', () => {
  const character = loaded({ emotion: 'thinking', animation: 'thinking_side' })
  const { emotion } = waitingPerformance(character)
  const resolved = resolveClip(character, emotion, 'idle', true, waitingOverride(character))
  assert.equal(resolved?.animationId, 'thinking_side')
  assert.equal(resolved?.variant, 'idle')
  assert.equal(resolved?.reactionId, null)
  assert.equal(resolved?.clip.loop, true)
})

test('phase machine: waiting starts on submit and ends on response, error or cancel', () => {
  assert.equal(nextPhase('input', 'submit'), 'waiting')
  assert.equal(presentationState('waiting'), 'waiting')
  assert.equal(nextPhase('waiting', 'response'), 'performing')
  assert.equal(nextPhase('waiting', 'error'), 'performing')
  assert.equal(nextPhase('waiting', 'cancel'), 'input')
  assert.equal(nextPhase('performing', 'finished'), 'input')
  assert.deepEqual((['input', 'waiting', 'performing'] as Phase[]).map(presentationState), ['idle', 'waiting', 'performing'])
})

test('phase machine never gets stuck: every state can reach input', () => {
  const phases: Phase[] = ['input', 'waiting', 'performing']
  const events: PhaseEvent[] = ['submit', 'response', 'error', 'cancel', 'finished']
  for (const start of phases) {
    let frontier = new Set<Phase>([start])
    let reached = start === 'input'
    for (let step = 0; step < 3 && !reached; step++) {
      frontier = new Set([...frontier].flatMap((p) => events.map((e) => nextPhase(p, e))))
      reached = frontier.has('input')
    }
    assert.ok(reached, `${start} cannot return to input`)
  }
  // Stray events are ignored rather than corrupting the state.
  assert.equal(nextPhase('input', 'response'), 'input')
  assert.equal(nextPhase('performing', 'submit'), 'performing')
})
