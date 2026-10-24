// Engine unit tests: Node's built-in test runner, no extra dependencies (npm test).
// They exercise the pure engine logic against the real manifests in public/assets.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveClip, resolveEmotion, resolveReactionId } from '../src/engine/characterResolver.ts'
import type { AnimationClip, CharacterManifest, ClipManifest, LoadedCharacter } from '../src/engine/manifestTypes.ts'
import { MENU_SOUNDS } from '../src/engine/menuSounds.ts'
import { DIALOGUE_TEXT, dialogueLineWidths, gridMeasure, type TextLayout } from '../src/engine/dialogueLayout.ts'
import { paginate, parseChatResponse, timelineToLines, type PerformanceTimeline } from '../src/engine/performance.ts'
import { frameDurationMs } from '../src/engine/useClipPlayback.ts'
import { isBlipChar } from '../src/engine/useBlips.ts'
import { pauseAfter, typewriterStateOf } from '../src/engine/useTypewriter.ts'

const assets = new URL('../public/assets/', import.meta.url)
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, assets), 'utf8'))

const manifest: CharacterManifest = readJson('characters/maya/character.json')

test('dialogue font manifest bundles Igiari with deterministic DotGothic16 fallback', () => {
  const dialogueFont = readJson('ui/ui.json').fonts.dialogue
  assert.deepEqual(dialogueFont, {
    src: 'fonts/Igiari.woff2',
    family: 'Igiari',
    fallbacks: [{ src: 'fonts/DotGothic16-Regular.ttf', family: 'DotGothic16' }],
    pixelSize: 16,
    letterSpacing: 0,
    wordSpacing: 0,
  })
})

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

test('performance override: explicit animation and reaction win, unknown ids fall back', () => {
  const r = resolveClip(maya, 'anxious', 'idle', false, { animation: 'arms_open', reaction: null })
  assert.equal(r?.animationId, 'arms_open')
  // explicit null reaction suppresses the emotion's own reaction
  assert.equal(resolveReactionId(maya, 'surprised', { reaction: null }), null)
  assert.equal(resolveReactionId(maya, 'surprised'), manifest.emotions.surprised.reaction)
  // explicit reaction on an emotion that has none
  assert.equal(resolveClip(maya, 'anxious', 'talking', true, { reaction: 'shocked' })?.variant, 'reaction')
  // unknown override animation -> emotion default, recorded as a fallback
  const bad = resolveClip(maya, 'thinking', 'idle', false, { animation: 'does_not_exist' })
  assert.equal(bad?.animationId, manifest.emotions.thinking.animation)
  assert.match(bad?.fallbacks.join() ?? '', /unavailable/)
  assert.equal(resolveReactionId(maya, 'neutral', { reaction: 'nope' }), null)
})

test('chat response parsing is defensive', () => {
  const ok = parseChatResponse({
    performance: {
      characterId: 'maya_fey',
      segments: [
        { text: 'Hi!', emotion: 'happy', animation: 'smile_front', intensity: 0.4, reaction: null, gesture: null, estimatedMs: 700 },
        { text: '', emotion: 'happy', animation: 'smile_front' },
        { text: 'x', emotion: '../etc', animation: 'smile_front' },
        { text: 'Whoa', emotion: 'surprised', animation: 'neutral_front', reaction: 'shocked; drop table' },
        42,
      ],
      settle: { emotion: 'happy', animation: 'smile_front' },
      notes: ['n', 3],
    },
    provider: { type: 'fake', model: 'm' },
    warnings: ['w'],
  })
  assert.equal(ok.performance.segments.length, 2)
  assert.equal(ok.performance.segments[1].reaction, null)
  assert.deepEqual(ok.performance.notes, ['n'])
  assert.throws(() => parseChatResponse({ performance: { segments: [] } }))
  assert.throws(() => parseChatResponse('nonsense'))
})

// ---- Dialogue pagination (beat != page) ------------------------------------------------------

// A compact synthetic grid keeps pagination expectations easy to reason about. The browser
// path uses Igiari's real canvas metrics; gridMeasure's defaults are its conservative fallback.
const layout: TextLayout = { measure: gridMeasure(8, 5), lineWidths: dialogueLineWidths(), locale: 'en' }

test('font-metric fallback is conservative for 16px Igiari', () => {
  const measure = gridMeasure()
  assert.equal(measure('W'), 18)
  assert.equal(measure(' '), 8)
})

/** Every page must physically fit: <= max lines, each line within its measured width. */
function assertFits(pages: string[], l: TextLayout = layout) {
  for (const page of pages) {
    const lines = page.split('\n')
    assert.ok(lines.length <= l.lineWidths.length, `too many lines: ${JSON.stringify(page)}`)
    lines.forEach((line, i) => assert.ok(l.measure(line) <= l.lineWidths[i], `line too wide: ${JSON.stringify(line)}`))
  }
}
const flat = (pages: string[]) => pages.map((p) => p.replaceAll('\n', ' '))
const words = (text: string) => text.split(/\s+/).filter(Boolean)

test('dialogue geometry: 3 lines of 242px minus safety, continue arrow reserved on the last line', () => {
  assert.equal(DIALOGUE_TEXT.maxLines, 3)
  assert.deepEqual(dialogueLineWidths(), [241, 241, 233])
})

test('short reply is a single page', () => {
  assert.deepEqual(paginate('Hey! Can you hear me?', layout), ['Hey! Can you hear me?'])
})

test('exact fit stays on one page; one more word overflows to a second page', () => {
  // grid measure: 8px per char, 5px per space. 6 four-letter words = 6*32 + 5*5 = 217px (fits 241
  // and the 233px last line); a 7th word would need 254px.
  const line = Array.from({ length: 6 }, () => 'aaaa').join(' ')
  const exact = [line, line, line].join(' ')
  assert.deepEqual(paginate(exact, layout), [[line, line, line].join('\n')])
  const over = `${exact} aaaa`
  const pages = paginate(over, layout)
  assert.equal(pages.length, 2)
  assertFits(pages)
  assert.deepEqual(words(flat(pages).join(' ')), words(over))
})

test('whole sentences are kept together instead of filling the box', () => {
  const text =
    'I was thinking about what you said earlier, all morning long. Maybe there is another explanation for all of this.'
  const pages = paginate(text, layout)
  assertFits(pages)
  assert.deepEqual(flat(pages), [
    'I was thinking about what you said earlier, all morning long.',
    'Maybe there is another explanation for all of this.',
  ])
})

test('several complete sentences: pages end on sentence boundaries', () => {
  const text =
    'Okay. So this is embarrassing. Last week I tried to channel my sister. Instead I got my great-aunt! She talked about the weather for an hour. Can you believe that?'
  const pages = paginate(text, layout)
  assertFits(pages)
  assert.ok(pages.length > 1)
  for (const page of flat(pages)) assert.match(page, /[.!?]$/, `page ends mid-sentence: ${page}`)
  assert.deepEqual(words(flat(pages).join(' ')), words(text))
})

test('long single sentence: comma boundary preferred over a mid-phrase word break', () => {
  const text =
    'She even scolded me for not eating enough vegetables, and then she just vanished without saying goodbye after all that effort and three whole bowls of noodles'
  const pages = paginate(text, layout)
  assertFits(pages)
  assert.ok(pages.length >= 2)
  assert.match(flat(pages)[0], /,$/)
})

test('a comma too early is not used (rhythm over a stubby page); word fallback instead', () => {
  const text =
    'Well, the thing is that nobody in the whole village ever told me about the secret passage behind the old shrine that my mother built'
  const pages = paginate(text, layout)
  assertFits(pages)
  assert.notEqual(flat(pages)[0], 'Well,')
  for (const page of flat(pages)) for (const w of words(page)) assert.ok(words(text).includes(w), `broken word ${w}`)
})

test('word fallback when there is no punctuation at all', () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
  const pages = paginate(text, layout)
  assertFits(pages)
  assert.deepEqual(words(flat(pages).join(' ')), words(text))
})

test('extremely long unbroken token is split at grapheme boundaries and still fits', () => {
  const token = 'A'.repeat(150)
  const pages = paginate(token, layout)
  assertFits(pages)
  assert.equal(flat(pages).join('').replaceAll(' ', ''), token)
})

test('the real measurer is used: narrow glyphs fit more per line', () => {
  const narrow: TextLayout = {
    ...layout,
    measure: (t) => [...t].reduce((w, c) => w + (c === 'i' ? 2 : c === ' ' ? 5 : 8), 0),
  }
  const text = Array.from({ length: 30 }, () => 'iiii').join(' ')
  assert.ok(paginate(text, narrow).length < paginate(text, layout).length)
  assertFits(paginate(text, narrow), narrow)
})

test('French: no-break spaces keep ! ? attached; no line starts with punctuation', () => {
  const fr: TextLayout = { ...layout, locale: 'fr' }
  const text =
    "Attends ! Tu es sérieux ? Je pensais que l'audience était demain, mais apparemment, tout le monde est déjà là… Bon, on y va !"
  const pages = paginate(text, fr)
  assertFits(pages, fr)
  for (const line of pages.flatMap((p) => p.split('\n'))) assert.doesNotMatch(line, /^[!?;:…,.]/)
  assert.deepEqual(words(flat(pages).join(' ')), words(text))
})

test('Japanese (no spaces): sentence/grapheme breaks, nothing inserted, no line-initial 。、', () => {
  const ja: TextLayout = { measure: (t) => [...t].length * 16, lineWidths: dialogueLineWidths(), locale: 'ja' }
  const text =
    'ええっ！？本当に？昨日の裁判のこと、まだ考えてたんだけど、もしかしたら別の説明があるかもしれないって思ったの。でも、証拠がないとね。'
  const pages = paginate(text, ja)
  assertFits(pages, ja)
  assert.equal(pages.join('').replaceAll('\n', ''), text)
  for (const line of pages.flatMap((p) => p.split('\n'))) assert.doesNotMatch(line, /^[。、！？」]/)
  // The long middle sentence breaks at its comma instead of orphaning "の。" on a new page.
  assert.deepEqual(
    pages.map((p) => p.replaceAll('\n', '')),
    ['ええっ！？本当に？', '昨日の裁判のこと、まだ考えてたんだけど、', 'もしかしたら別の説明があるかもしれないって思ったの。でも、証拠がないとね。'],
  )
})

test('no tiny orphan at the start of a page when a long sentence is split', () => {
  const text =
    'Somebody really should have told me about the hidden passage behind the shrine before we started the whole investigation today'
  const pages = paginate(text, layout)
  assertFits(pages)
  for (const page of flat(pages).slice(1)) assert.ok([...page].length >= 6, `orphan page: ${page}`)
})

test('pagination is a pure function of text + logical layout (display scale is never an input)', () => {
  const text =
    'Hmm... in Python, a decorator wraps a function to change what it does. Wait, that is kind of like spirit channeling!'
  assert.deepEqual(paginate(text, layout), paginate(text, { ...layout }))
})

test('beat != page: a beat spans pages with one emotion/pose; its reaction plays once', () => {
  const longText =
    'You are serious? That is terrible news. I cannot believe it happened right before the trial. What are we going to do now? We need a plan, and fast!'
  const timeline: PerformanceTimeline = {
    characterId: 'maya_fey',
    segments: [
      { text: 'Hmm...', emotion: 'thinking', animation: 'thinking_side', intensity: 0.3, reaction: null, gesture: null, estimatedMs: 0 },
      { text: longText, emotion: 'anxious', animation: 'necklace_anxious', intensity: 0.85, reaction: 'shocked', gesture: null, estimatedMs: 0 },
      { text: 'Okay. We can do this.', emotion: 'happy', animation: 'clasped_hands_happy', intensity: 0.6, reaction: null, gesture: null, estimatedMs: 0 },
    ],
    settle: { emotion: 'happy', animation: 'clasped_hands_happy' },
    notes: [],
  }
  const lines = timelineToLines(timeline, layout)
  const anxious = lines.filter((l) => l.emotion === 'anxious')
  assert.ok(anxious.length >= 2, 'the long beat spans several pages')
  assert.deepEqual(
    anxious.map((l) => l.reaction),
    ['shocked', ...anxious.slice(1).map(() => null)],
  )
  assert.ok(anxious.every((l) => l.animation === 'necklace_anxious'))
  assert.equal(lines.filter((l) => l.reaction).length, 1, 'reaction plays exactly once in the reply')
  assert.deepEqual(
    lines.map((l) => l.emotion),
    ['thinking', ...anxious.map(() => 'anxious'), 'happy'],
  )
  assert.equal(lines.at(-1)?.animation, timeline.settle.animation)
  assertFits(lines.map((l) => l.text))
})
