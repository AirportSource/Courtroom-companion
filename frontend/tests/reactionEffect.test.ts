import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveClip } from '../src/engine/characterResolver.ts'
import type { AnimationClip, LoadedCharacter, ReactionEffect } from '../src/engine/manifestTypes.ts'
import { effectDurationMs, effectSchedule } from '../src/engine/reactionEffect.ts'
import { selectPresentation } from '../src/engine/presentationContext.ts'

const root = new URL('../public/assets/', import.meta.url)
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const franziska = json('characters/franziska/character.json')
const audio = json('audio/audio.json')
const whip = franziska.reactions.whip_crack

/** A clip built from manifest data, without loading images (the browser loader does that). */
function clipOf(raw: { frames: string[]; fps: number; frameDurations?: number[]; canvas?: { width: number; height: number } }, key: string): AnimationClip {
  return {
    key, fps: raw.fps, loop: false, aligned: true, holdJitterMs: 0,
    canvas: raw.canvas ?? { width: 256, height: 192 },
    frames: raw.frames.map((path, index) => ({ path, url: path, width: 256, height: 192, x: 0, y: 0, durationMs: raw.frameDurations?.[index] })),
  }
}

const effect: ReactionEffect = {
  overlay: clipOf(whip.effect.overlay, 'whip:overlay'),
  overlayStartMs: whip.effect.overlayStartMs,
  cues: whip.effect.cues,
}
const body = { ...clipOf(whip, 'reaction:whip_crack'), effect }

function character(): LoadedCharacter {
  const stable = clipOf({ frames: ['idle.png'], fps: 1 }, 'angry_fists.idle')
  return {
    id: 'franziska_von_karma', displayName: 'Franziska', names: {}, anchor: { horizontal: 'center', vertical: 'bottom' },
    render: { scale: 1, offsetX: 0, offsetY: 0 }, voice: {}, defaultEmotion: 'neutral', fallbackEmotion: 'neutral',
    animations: { angry_fists: { id: 'angry_fists', idle: stable, talking: stable }, neutral: { id: 'neutral', idle: stable } },
    reactions: { whip_crack: body },
    emotions: { angry: { animation: 'angry_fists' }, neutral: { animation: 'neutral' } },
    warnings: [],
  }
}

test('the whip overlay frames exist, are full-stage and come from the converted reference GIF', () => {
  assert.equal(whip.effect.overlay.frames.length, 20)
  assert.deepEqual(whip.effect.overlay.canvas, { width: 256, height: 192 })
  for (const frame of whip.effect.overlay.frames as string[]) {
    assert.ok(!/^[a-z]:|^\/|file:|\.\.|(^|\/)assets\//i.test(frame), `${frame} must be pack-relative`)
    const png = readFileSync(new URL(`characters/franziska/${frame}`, root))
    assert.equal(png.toString('ascii', 1, 4), 'PNG')
    assert.equal(png.readUInt32BE(16), 256) // IHDR width
    assert.equal(png.readUInt32BE(20), 192) // IHDR height
    assert.equal(png[25], 6, `${frame} must be RGBA (transparent, never a black rectangle)`)
  }
  const source = json('characters/franziska/effects/whip_slash/source.json')
  assert.equal(source.timingInferred, true)
  assert.equal(source.source, 'assets/other assets/whip/whip effect gif.gif')
})

test('a whip reaction resolves to the body clip carrying the effect, then settles to the stable pose', () => {
  const c = character()
  const playing = resolveClip(c, 'angry', 'idle', true, { reaction: 'whip_crack' })
  assert.equal(playing?.variant, 'reaction')
  assert.equal(playing?.reactionId, 'whip_crack')
  assert.equal(playing?.clip.effect?.overlay?.frames.length, 20)
  const settled = resolveClip(c, 'angry', 'idle', false, { reaction: 'whip_crack' })
  assert.equal(settled?.variant, 'idle')
  assert.equal(settled?.animationId, 'angry_fists')
})

test('angry is an emotion, not a whip: no emotion binding plays the whip by itself', () => {
  const bindings = [franziska.emotions, ...Object.values(franziska.presentationGroups as Record<string, { emotions: Record<string, { reaction?: string }> }>).map((g) => g.emotions)]
  for (const emotions of bindings) {
    for (const [emotion, binding] of Object.entries(emotions as Record<string, { reaction?: string }>)) {
      assert.notEqual(binding.reaction, 'whip_crack', `${emotion} must not imply a whip`)
    }
  }
  assert.equal(resolveClip(character(), 'angry', 'idle', true)?.variant, 'idle')
  const perf = json('characters/franziska/performance.json')
  const sig = perf.sfx.signature.find((s: { id: string }) => s.id === 'whip')
  assert.equal(sig.performs, 'whip_crack')
  assert.ok(sig.cooldownTurns >= 3 && sig.maxPerReply === 1)
})

test('whip sound is scheduled first and the whack follows closely, in step with the overlay', () => {
  const steps = effectSchedule(effect)
  const cues = steps.filter((s) => s.kind === 'cue')
  assert.deepEqual(cues.map((s) => s.kind === 'cue' && s.event), ['whip_swing', 'whip_impact', 'whip_swing', 'whip_impact'])
  for (let i = 0; i < cues.length; i += 2) {
    const gap = cues[i + 1].atMs - cues[i].atMs
    assert.ok(gap > 0 && gap <= 200, `whack ${gap} ms after the whip`)
  }
  for (const cue of cues) if (cue.kind === 'cue') assert.ok(audio.events[cue.event], `${cue.event} is an audio event`)
  const overlay = steps.filter((s) => s.kind === 'overlay')
  assert.equal(overlay[0].atMs, effect.overlayStartMs)
  assert.equal(cues[0].atMs, effect.overlayStartMs) // the swing sound starts with the first slash frame
  // Each whack lands while its slash is on screen (first slash frames 0-5, second 10-15).
  const frameAt = (ms: number) => overlay.filter((s) => s.atMs <= ms).at(-1)
  for (const [cue, range] of [[cues[1], [0, 6]], [cues[3], [10, 16]]] as const) {
    const shown = frameAt(cue.atMs)
    assert.ok(shown?.kind === 'overlay' && shown.frame !== null && shown.frame >= range[0] && shown.frame < range[1])
  }
})

test('the effect completes inside the body reaction and leaves no overlay behind', () => {
  const steps = effectSchedule(effect)
  const last = steps.at(-1)
  assert.ok(last?.kind === 'overlay' && last.frame === null, 'the final step clears the overlay')
  const bodyMs = (whip.frameDurations as number[]).reduce((a, b) => a + b, 0)
  assert.equal(bodyMs, 1500)
  assert.equal(effectDurationMs(effect), effect.overlayStartMs + 20 * (1000 / whip.effect.overlay.fps))
  assert.ok(effectDurationMs(effect) < bodyMs, 'the slash ends before Franziska settles')
})

test('steps are ordered and an empty effect schedules nothing', () => {
  const steps = effectSchedule(effect)
  assert.ok(steps.every((step, i) => i === 0 || steps[i - 1].atMs <= step.atMs))
  assert.deepEqual(effectSchedule({ overlay: null, overlayStartMs: 0, cues: [] }), [])
  assert.ok(existsSync(new URL('characters/franziska/effects/whip_slash/frame_019.png', root)))
})

test('conversation never uses courtroom side sprites: groups refuse shared reactions', () => {
  for (const id of ['franziska', 'edgeworth']) {
    const pack = json(`characters/${id}/character.json`)
    const conversation = pack.presentationGroups.conversation
    assert.equal(conversation.inheritReactions, false, `${id} conversation must not inherit courtroom reactions`)
    for (const [name, clip] of Object.entries(conversation.reactions ?? {}) as [string, { frames: string[] }][]) {
      for (const frame of clip.frames) assert.ok(frame.startsWith('conversation/'), `${id} ${name}: ${frame} is not a conversation sprite`)
    }
    for (const binding of Object.values(conversation.emotions as Record<string, { reaction?: string }>)) {
      if (binding.reaction) assert.ok(conversation.reactions?.[binding.reaction], `${id}: ${binding.reaction} must be a conversation reaction`)
    }
  }
})

test('conversation whip: black screen with the slash, then a slow fade back to Franziska', () => {
  const conv = franziska.presentationGroups.conversation.reactions.whip_crack
  const convEffect: ReactionEffect = {
    overlay: clipOf(conv.effect.overlay, 'conv:overlay'), overlayStartMs: conv.effect.overlayStartMs,
    backdrop: { color: conv.effect.backdrop.color, fadeStartMs: conv.effect.backdrop.fadeStartMs, fadeMs: conv.effect.backdrop.fadeMs },
    cues: conv.effect.cues,
  }
  assert.equal(convEffect.backdrop?.color, '#000000')
  const steps = effectSchedule(convEffect)
  const backdrop = steps.filter((s) => s.kind === 'backdrop')
  assert.deepEqual(backdrop.map((s) => s.kind === 'backdrop' && [s.atMs, s.state]), [[0, 'on'], [800, 'fade'], [1700, 'off']])
  // The black arrives with the first lash and its swing sound, never before the whip is used.
  assert.equal(convEffect.overlayStartMs, 0)
  assert.equal(steps.find((s) => s.kind === 'cue')?.atMs, 0)
  const overlayEnd = steps.filter((s) => s.kind === 'overlay').at(-1)!.atMs
  assert.ok(overlayEnd <= convEffect.backdrop!.fadeStartMs, 'the screen stays black until the slash is over')
  // Same approved lash timing and sounds as the courtroom version, without its body wind-up.
  const shift = whip.effect.overlayStartMs - conv.effect.overlayStartMs
  assert.deepEqual(conv.effect.cues, whip.effect.cues.map((cue: { atMs: number; event: string }) => ({ ...cue, atMs: cue.atMs - shift })))
  assert.deepEqual(conv.effect.overlay.frames, whip.effect.overlay.frames)
  // The body under the black is the front-facing angry pose, held until the fade has finished.
  const angry = franziska.presentationGroups.conversation.emotions.angry.animation
  assert.equal(conv.frames[0], franziska.presentationGroups.conversation.animations[angry].idle.frames[0])
  assert.ok(conv.frameDurations.reduce((a: number, b: number) => a + b, 0) >= effectDurationMs(convEffect))
})

test('a group with inheritReactions false exposes only its own reactions', () => {
  const base = character()
  const own = clipOf({ frames: ['conversation/x.png'], fps: 10 }, 'conv:whip')
  const group = { animations: base.animations, emotions: base.emotions, reactions: { whip_crack: own }, render: base.render,
    defaultEmotion: 'neutral', fallbackEmotion: 'neutral' }
  const withCourt = { ...base, reactions: { ...base.reactions, whip_raise: body } }
  const refused = selectPresentation({ ...withCourt, presentationGroups: { conversation: { ...group, inheritReactions: false } } }, 'conversation')
  assert.deepEqual(Object.keys(refused.reactions), ['whip_crack'])
  assert.equal(refused.reactions.whip_crack, own)
  const inherited = selectPresentation({ ...withCourt, presentationGroups: { courtroom: { ...group } } }, 'courtroom')
  assert.deepEqual(Object.keys(inherited.reactions).sort(), ['whip_crack', 'whip_raise'])
})
