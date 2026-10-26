// Validates runtime asset manifests under public/assets against the filesystem.
// Usage: npm run validate:assets
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
// Node 24 strips TypeScript types natively: the runtime validators stay the single source of truth.
import { validateSoundtrackManifest } from '../src/music/soundtrack.ts'
import { validateLoopRegion } from '../src/music/loopMath.ts'
import { validateCourtRecordManifest } from '../src/courtRecord/courtRecord.ts'
import { READINESS_LEVELS } from '../src/engine/characterReadiness.ts'
import { SFX_NAMES } from '../src/engine/sfx.ts'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets')
const MEDIA = /\.(png|gif|webp|jpe?g|wav|mp3|ogg|m4a|flac|ttf|otf|woff2?)$/i

const errors = []
const referenced = new Set()

const rel = (p) => relative(ASSETS, p).replaceAll('\\', '/')

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    errors.push(`${rel(path)}: cannot parse (${err.message})`)
    return null
  }
}

function checkFile(baseDir, src, where) {
  if (typeof src !== 'string' || src.length === 0) {
    errors.push(`${where}: missing path`)
    return
  }
  if (/\s/.test(src)) errors.push(`${where}: path contains whitespace: ${src}`)
  const full = join(baseDir, src)
  const confined = relative(resolve(ASSETS), resolve(full))
  if (isAbsolute(src) || /^[a-z][a-z0-9+.-]*:/i.test(src) || confined.startsWith('..') || isAbsolute(confined)) {
    errors.push(`${where}: path must stay inside runtime assets: ${src}`)
    return
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    errors.push(`${where}: file not found: ${rel(full)}`)
    return
  }
  referenced.add(rel(full))
}

function pngSize(path) {
  const buf = readFileSync(path)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

// Optional canvas/offsets (D-022): offsets need a canvas, match the frame count, are
// non-negative integer pairs, and every frame must fit inside the canvas.
function checkPlacement(packDir, clip, canvas, where) {
  if (clip.offsets === undefined && canvas === undefined) return
  if (canvas !== undefined && !(Number.isInteger(canvas?.width) && Number.isInteger(canvas?.height) && canvas.width > 0 && canvas.height > 0)) {
    errors.push(`${where}: invalid canvas`)
    return
  }
  if (clip.offsets === undefined) return
  if (canvas === undefined) {
    errors.push(`${where}: offsets without a canvas`)
    return
  }
  if (!Array.isArray(clip.offsets) || clip.offsets.length !== clip.frames.length) {
    errors.push(`${where}: offsets count does not match frames`)
    return
  }
  clip.offsets.forEach((offset, i) => {
    const ok = Array.isArray(offset) && offset.length === 2 && offset.every((n) => Number.isInteger(n) && n >= 0)
    if (!ok) {
      errors.push(`${where}.offsets[${i}]: expected [x, y] non-negative integers`)
      return
    }
    const full = join(packDir, clip.frames[i])
    if (!existsSync(full) || !/\.png$/i.test(full)) return
    const { width, height } = pngSize(full)
    if (offset[0] + width > canvas.width || offset[1] + height > canvas.height) {
      errors.push(`${where}.frames[${i}]: ${width}x${height} at (${offset}) exceeds canvas ${canvas.width}x${canvas.height}`)
    }
  })
}

// Optional per-frame timing: frameDurations parallel to frames (positive ms), holdJitterMs >= 0.
function checkTiming(clip, where) {
  if (clip.frameDurations !== undefined) {
    const ok =
      Array.isArray(clip.frameDurations) &&
      clip.frameDurations.length === clip.frames.length &&
      clip.frameDurations.every((d) => typeof d === 'number' && d > 0)
    if (!ok) errors.push(`${where}: frameDurations must be positive ms, one per frame`)
  }
  if (clip.holdJitterMs !== undefined && !(typeof clip.holdJitterMs === 'number' && clip.holdJitterMs >= 0)) {
    errors.push(`${where}: holdJitterMs must be a non-negative number`)
  }
}

function listMedia(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listMedia(full)
    return MEDIA.test(entry.name) ? [rel(full)] : []
  })
}

// Audio
const audioDir = join(ASSETS, 'audio')
const audio = readJson(join(audioDir, 'audio.json'))
const soundIds = new Set()
if (audio) {
  const categories = new Set(audio.categories ?? [])
  for (const [id, sound] of Object.entries(audio.sounds ?? {})) {
    soundIds.add(id)
    if (!categories.has(sound.category)) {
      errors.push(`audio.json sounds.${id}: unknown category "${sound.category}"`)
    }
    checkFile(audioDir, sound.src, `audio.json sounds.${id}`)
    if (sound.loop && (!Number.isFinite(sound.loop.startSeconds) || !Number.isFinite(sound.loop.endSeconds)
      || sound.loop.startSeconds < 0 || sound.loop.endSeconds <= sound.loop.startSeconds)) {
      errors.push(`audio.json sounds.${id}: invalid loop seconds`)
    }
  }
  // Ringtone presets (D-059): each references an existing sound; the default must exist.
  if (audio.ringtones !== undefined) {
    const items = audio.ringtones?.items ?? {}
    if (!Object.hasOwn(items, audio.ringtones?.default)) {
      errors.push(`audio.json ringtones.default: unknown ringtone "${audio.ringtones?.default}"`)
    }
    for (const [id, item] of Object.entries(items)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) errors.push(`audio.json ringtones.items.${id}: invalid id`)
      if (typeof item?.label !== 'string' || !item.label) errors.push(`audio.json ringtones.items.${id}: missing label`)
      if (!soundIds.has(item?.sound)) errors.push(`audio.json ringtones.items.${id}: unknown sound id "${item?.sound}"`)
    }
  }
  for (const [event, soundId] of Object.entries(audio.events ?? {})) {
    if (!soundIds.has(soundId)) errors.push(`audio.json events.${event}: unknown sound id "${soundId}"`)
  }
  // Semantic sounds (D-092): every name has a global event; shared pools name real sounds.
  for (const name of SFX_NAMES) {
    if (!audio.events?.[`sfx_${name}`]) errors.push(`audio.json events: no global event "sfx_${name}"`)
  }
  checkSemanticSounds(audio.semanticSounds, 'audio.json semanticSounds')
}

function checkSemanticSounds(pools, where) {
  if (pools === undefined) return
  if (typeof pools !== 'object' || pools === null || Array.isArray(pools)) {
    errors.push(`${where}: must be an object`)
    return
  }
  for (const [name, ids] of Object.entries(pools)) {
    if (!SFX_NAMES.includes(name)) errors.push(`${where}.${name}: unknown semantic sound`)
    if (!Array.isArray(ids) || ids.length === 0) { errors.push(`${where}.${name}: needs a non-empty list`); continue }
    for (const id of ids) if (!soundIds.has(id)) errors.push(`${where}.${name}: unknown sound id "${id}"`)
  }
}

/** Manifests must never point at a user's machine or at the repository's source `assets/` tree. */
function checkNoMachinePaths(value, where) {
  if (typeof value === 'string') {
    if (/^[a-z]:[\\/]|^file:|^\\\\|(^|[\\/])Courtroom-companion[\\/]assets[\\/]/i.test(value)) {
      errors.push(`${where}: machine or source-tree path not allowed at runtime: ${value}`)
    }
  } else if (Array.isArray(value)) value.forEach((item, i) => checkNoMachinePaths(item, `${where}[${i}]`))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) checkNoMachinePaths(v, `${where}.${k}`)
}
if (audio) checkNoMachinePaths(audio, 'audio.json')

/** A reaction's one-shot effect (D-091): overlay frames on their canvas, cues on audio events. */
function checkReactionEffect(packDir, effect, where) {
  if (effect === undefined) return
  if (effect?.overlay !== undefined) {
    const frames = effect.overlay?.frames
    if (!Array.isArray(frames) || frames.length === 0) errors.push(`${where}.overlay: no frames`)
    else {
      frames.forEach((f, i) => checkFile(packDir, f, `${where}.overlay[${i}]`))
      checkPlacement(packDir, effect.overlay, effect.overlay.canvas, `${where}.overlay`)
      if (effect.overlay.loop === true) errors.push(`${where}.overlay: must be one-shot`)
    }
  }
  const backdrop = effect?.backdrop
  if (backdrop !== undefined && !(Number.isFinite(backdrop?.fadeStartMs) && backdrop.fadeStartMs >= 0
    && Number.isFinite(backdrop?.fadeMs) && backdrop.fadeMs >= 0
    && (backdrop.color === undefined || /^#[0-9a-f]{6}$/i.test(backdrop.color)))) {
    errors.push(`${where}.backdrop: needs fadeStartMs >= 0, fadeMs >= 0 and an optional #rrggbb color`)
  }
  if (effect?.overlayStartMs !== undefined && !(Number.isFinite(effect.overlayStartMs) && effect.overlayStartMs >= 0)) {
    errors.push(`${where}.overlayStartMs: must be >= 0`)
  }
  for (const [i, cue] of (effect?.cues ?? []).entries()) {
    if (!(Number.isFinite(cue?.atMs) && cue.atMs >= 0)) errors.push(`${where}.cues[${i}]: invalid atMs`)
    if (!audio?.events?.[cue?.event]) errors.push(`${where}.cues[${i}]: unknown audio event "${cue?.event}"`)
  }
}

// Backgrounds
const bgDir = join(ASSETS, 'backgrounds')
const backgrounds = readJson(join(bgDir, 'backgrounds.json'))
if (backgrounds) {
  for (const [id, bg] of Object.entries(backgrounds.backgrounds ?? {})) {
    const where = `backgrounds.json ${id}`
    checkFile(bgDir, bg.src, where)
    const full = join(bgDir, bg.src)
    if (existsSync(full) && /\.png$/i.test(bg.src)) {
      const { width, height } = pngSize(full)
      if (width !== bg.width || height !== bg.height) {
        errors.push(`${where}: declared ${bg.width}x${bg.height}, actual ${width}x${height}`)
      }
    }
    // Optional foreground layer (D-096): same size as the plate, so it lines up exactly.
    if (bg.foreground !== undefined) {
      checkFile(bgDir, bg.foreground, `${where} foreground`)
      const layer = join(bgDir, bg.foreground ?? '')
      if (existsSync(layer) && /\.png$/i.test(layer)) {
        const { width, height } = pngSize(layer)
        if (width !== bg.width || height !== bg.height) errors.push(`${where} foreground: ${width}x${height}, plate is ${bg.width}x${bg.height}`)
      }
    }
    if (bg.characterOffsetY !== undefined && !(Number.isInteger(bg.characterOffsetY) && Math.abs(bg.characterOffsetY) <= 96)) {
      errors.push(`${where} characterOffsetY: must be an integer within ±96`)
    }
  }
}

// UI (fonts + images)
const uiDir = join(ASSETS, 'ui')
const ui = existsSync(join(uiDir, 'ui.json')) ? readJson(join(uiDir, 'ui.json')) : null
if (ui) {
  for (const [id, font] of Object.entries(ui.fonts ?? {})) {
    checkFile(uiDir, font.src, `ui.json fonts.${id}`)
    if (typeof font.family !== 'string' || font.family.length === 0) errors.push(`ui.json fonts.${id}: missing family`)
    const fallbacks = Array.isArray(font.fallbacks) ? font.fallbacks : []
    if (font.fallbacks !== undefined && !Array.isArray(font.fallbacks)) {
      errors.push(`ui.json fonts.${id}.fallbacks: expected an array`)
    }
    for (const [fallbackIndex, fallback] of fallbacks.entries()) {
      const where = `ui.json fonts.${id}.fallbacks[${fallbackIndex}]`
      checkFile(uiDir, fallback?.src, where)
      if (typeof fallback?.family !== 'string' || fallback.family.length === 0) errors.push(`${where}: missing family`)
    }
  }
  for (const [id, image] of Object.entries(ui.images ?? {})) {
    const where = `ui.json images.${id}`
    checkFile(uiDir, image.src, where)
    const full = join(uiDir, image.src)
    if (existsSync(full) && /\.png$/i.test(image.src)) {
      const { width, height } = pngSize(full)
      if (width !== image.width || height !== image.height) {
        errors.push(`${where}: declared ${image.width}x${image.height}, actual ${width}x${height}`)
      }
    }
  }
}

// Music (original soundtrack). Excluded tracks are manifest-only (no runtime file).
const musicDir = join(ASSETS, 'music')
const soundtrack = existsSync(join(musicDir, 'soundtrack.json')) ? readJson(join(musicDir, 'soundtrack.json')) : null
// The OST media are local-only (not in Git, see docs/MUSIC.md): a clone without any of them is valid,
// but once some tracks of a disc are installed, every referenced track of that disc must be present
// (the PWAA zip installs disc 1 only; the Trilogy discs 2-3 come from a separate source).
// Resolve installed groups from manifest entries: DS filenames have no disc prefix,
// and native-rate lossless FLAC must participate just like the older MP3s.
const installedDiscs = new Set(Object.values(soundtrack?.tracks ?? {})
  .filter((track) => typeof track?.src === 'string' && existsSync(join(musicDir, track.src)))
  .map((track) => String(track.disc ?? 1)))
const ostInstalled = installedDiscs.size > 0
if (soundtrack && !ostInstalled) {
  console.log('Note: original soundtrack not installed (python scripts/install_ost.py <zip>); track files not checked.')
}
if (soundtrack) {
  for (const error of validateSoundtrackManifest(soundtrack)) errors.push(`music/soundtrack.json ${error}`)
  for (const [id, track] of Object.entries(soundtrack.tracks ?? {})) {
    if (track?.src !== undefined && installedDiscs.has(String(track.disc ?? 1))) checkFile(musicDir, track.src, `music/soundtrack.json tracks.${id}`)
    // Flat loop entries are canonical in samples; a malformed one would silently play unlooped.
    if (track?.loop !== null && track?.loop !== undefined) {
      const { startSample, endSample, sampleRate } = track.loop
      const result = validateLoopRegion({ startSample, endSample, sampleRate })
      if (!result.ok) errors.push(`music/soundtrack.json tracks.${id}.loop: ${result.reason}`)
    }
  }
}

// Court Record. The runtime drops malformed entries with a warning; here every warning fails.
const recordDir = join(ASSETS, 'court-record')
const record = existsSync(join(recordDir, 'court-record.json')) ? readJson(join(recordDir, 'court-record.json')) : null
if (record) {
  try {
    for (const warning of validateCourtRecordManifest(record).warnings) errors.push(`court-record.json ${warning}`)
  } catch (err) {
    errors.push(err.message)
  }
  for (const entry of Array.isArray(record.entries) ? record.entries : []) {
    const where = `court-record.json ${entry?.id}`
    checkFile(recordDir, entry?.asset?.src, where)
    const full = join(recordDir, entry?.asset?.src ?? '')
    if (existsSync(full) && /\.png$/i.test(full)) {
      const { width, height } = pngSize(full)
      if (width !== entry.asset.width || height !== entry.asset.height) {
        errors.push(`${where}: declared ${entry.asset.width}x${entry.asset.height}, actual ${width}x${height}`)
      }
    }
  }
}

// Characters
const charDir = join(ASSETS, 'characters')
const index = readJson(join(charDir, 'index.json'))
for (const [charId, manifestPath] of Object.entries(index?.characters ?? {})) {
  const manifestFile = join(charDir, manifestPath)
  if (!existsSync(manifestFile)) {
    errors.push(`characters/index.json ${charId}: manifest not found: ${manifestPath}`)
    continue
  }
  const char = readJson(manifestFile)
  if (!char) continue
  const packDir = dirname(manifestFile)
  const where = `characters/${manifestPath}`
  if (char.render !== undefined) {
    const { scale = 1, offsetX = 0, offsetY = 0 } = char.render
    if (!(typeof scale === 'number' && scale > 0)) errors.push(`${where} render.scale: must be a positive number`)
    if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY)) errors.push(`${where} render.offsetX/offsetY: must be integers`)
  }
  if (char.id !== charId) errors.push(`${where}: id "${char.id}" does not match index key "${charId}"`)

  const animations = char.animations ?? {}
  const reactions = char.reactions ?? {}
  const emotions = char.emotions ?? {}

  for (const [animId, anim] of Object.entries(animations)) {
    for (const variant of ['idle', 'talking']) {
      const frames = anim[variant]?.frames
      if (!Array.isArray(frames) || frames.length === 0) {
        errors.push(`${where} animations.${animId}.${variant}: no frames`)
        continue
      }
      frames.forEach((f, i) => checkFile(packDir, f, `${where} animations.${animId}.${variant}[${i}]`))
      checkPlacement(packDir, anim[variant], anim.canvas, `${where} animations.${animId}.${variant}`)
      checkTiming(anim[variant], `${where} animations.${animId}.${variant}`)
    }
  }
  for (const [reactId, reaction] of Object.entries(reactions)) {
    const frames = reaction.frames
    if (!Array.isArray(frames) || frames.length === 0) {
      errors.push(`${where} reactions.${reactId}: no frames`)
      continue
    }
    frames.forEach((f, i) => checkFile(packDir, f, `${where} reactions.${reactId}[${i}]`))
    checkPlacement(packDir, reaction, reaction.canvas, `${where} reactions.${reactId}`)
    checkReactionEffect(packDir, reaction.effect, `${where} reactions.${reactId}.effect`)
  }
  checkSemanticSounds(char.semanticSounds, `${where} semanticSounds`)
  checkNoMachinePaths(char, where)
  for (const f of char.unassignedFrames ?? []) checkFile(packDir, f, `${where} unassignedFrames`)

  for (const [emotion, target] of Object.entries(emotions)) {
    if (!animations[target.animation]) {
      errors.push(`${where} emotions.${emotion}: unknown animation "${target.animation}"`)
    }
    if (target.reaction !== undefined && !reactions[target.reaction]) {
      errors.push(`${where} emotions.${emotion}: unknown reaction "${target.reaction}"`)
    }
  }
  if (char.selectionPreview !== undefined) {
    checkFile(packDir, char.selectionPreview, `${where} selectionPreview`)
    if (typeof char.selectionPreview === 'string') {
      const preview = join(packDir, char.selectionPreview)
      if (existsSync(preview) && /\.png$/i.test(preview)) {
        const { width, height } = pngSize(preview)
        if (width !== height) errors.push(`${where} selectionPreview: must be square`)
      }
    }
  }
  // Optional square record portrait (D-058): file must exist and match its declared size.
  if (char.courtRecordPortrait !== undefined) {
    const portrait = char.courtRecordPortrait
    checkFile(packDir, portrait?.src, `${where} courtRecordPortrait`)
    const full = join(packDir, portrait?.src ?? '')
    if (existsSync(full) && /\.png$/i.test(full)) {
      const { width, height } = pngSize(full)
      if (width !== portrait.width || height !== portrait.height || width !== height) {
        errors.push(`${where} courtRecordPortrait: declared ${portrait.width}x${portrait.height}, actual ${width}x${height} (must be square)`)
      }
    }
  }
  // Optional waiting/thinking pose (D-048): must name a real emotion and animation.
  if (char.waiting !== undefined) {
    if (!emotions[char.waiting?.emotion]) errors.push(`${where} waiting.emotion: unknown emotion "${char.waiting?.emotion}"`)
    if (char.waiting?.animation !== undefined && !animations[char.waiting.animation]) {
      errors.push(`${where} waiting.animation: unknown animation "${char.waiting.animation}"`)
    }
  }
  for (const key of ['defaultEmotion', 'fallbackEmotion']) {
    if (!emotions[char[key]]) errors.push(`${where} ${key}: unknown emotion "${char[key]}"`)
  }
  if (char.voice?.blip !== undefined && !soundIds.has(char.voice.blip)) {
    errors.push(`${where} voice.blip: unknown sound id "${char.voice.blip}"`)
  }
  checkBehaviourData(char, packDir, where, animations, reactions, emotions)
  if (char.defaultPresentation !== undefined && !char.presentationGroups?.[char.defaultPresentation]) {
    errors.push(`${where} defaultPresentation: unknown group "${char.defaultPresentation}"`)
  }
  for (const [context, group] of Object.entries(char.presentationGroups ?? {})) {
    const at = `${where} presentationGroups.${context}`
    const groupAnimations = group?.animations ?? {}
    const groupReactions = group?.inheritReactions === false ? { ...group?.reactions } : { ...reactions, ...group?.reactions }
    const groupEmotions = group?.emotions ?? emotions
    if (!Object.keys(groupAnimations).length) errors.push(`${at}: no animations`)
    for (const [id, animation] of Object.entries(groupAnimations)) {
      for (const mode of ['idle', 'talking']) {
        const clip = animation?.[mode]
        if (!clip) continue
        checkPresentationClip(packDir, clip, animation.canvas, `${at} animations.${id}.${mode}`)
      }
      if (!animation?.idle && !animation?.talking) errors.push(`${at} animations.${id}: no clips`)
    }
    for (const [id, clip] of Object.entries(group?.reactions ?? {})) {
      checkPresentationClip(packDir, clip, clip?.canvas, `${at} reactions.${id}`)
      checkReactionEffect(packDir, clip?.effect, `${at} reactions.${id}.effect`)
      if (clip.loop !== false) errors.push(`${at} reactions.${id}: must be one-shot`)
    }
    for (const [id, binding] of Object.entries(groupEmotions)) {
      if (!groupAnimations[binding?.animation]) errors.push(`${at} emotions.${id}: unknown animation`)
      if (binding?.reaction !== undefined && !groupReactions[binding.reaction]) errors.push(`${at} emotions.${id}: unknown reaction`)
    }
    for (const key of ['defaultEmotion', 'fallbackEmotion']) {
      if (!groupEmotions[group?.[key] ?? char[key]]) errors.push(`${at} ${key}: unknown emotion`)
    }
    const waiting = group?.waiting ?? char.waiting
    if (waiting?.emotion !== undefined && !groupEmotions[waiting.emotion]) errors.push(`${at} waiting: unknown emotion`)
    if (waiting?.animation !== undefined && !groupAnimations[waiting.animation]) errors.push(`${at} waiting: unknown animation`)
    if (group?.render !== undefined) {
      const { scale = 1, offsetX = 0, offsetY = 0 } = group.render
      if (!(typeof scale === 'number' && scale > 0) || !Number.isInteger(offsetX) || !Number.isInteger(offsetY)) errors.push(`${at} render: invalid placement`)
    }
  }
}

function checkPresentationClip(packDir, clip, canvas, where) {
  if (!Array.isArray(clip?.frames) || clip.frames.length === 0) {
    errors.push(`${where}: no frames`)
    return
  }
  if (!(Number.isFinite(clip.fps) && clip.fps > 0)) errors.push(`${where}: invalid fps`)
  clip.frames.forEach((frame, i) => {
    if (!/\.png$/i.test(frame)) errors.push(`${where}[${i}]: explicit PNG frame required`)
    checkFile(packDir, frame, `${where}[${i}]`)
  })
  checkPlacement(packDir, clip, canvas, where)
  checkTiming(clip, where)
}

// Readiness and director data (character.json readiness, performance.json, personality.md).
// "ready" needs personality.md + performance.json; performance.json references must resolve;
// signature sounds need a real audio event sfx_<id> (they are never in the global set).
function checkBehaviourData(char, packDir, where, animations, reactions, emotions) {
  if (char.readiness !== undefined && !READINESS_LEVELS.includes(char.readiness)) {
    errors.push(`${where} readiness: must be one of ${READINESS_LEVELS.join(', ')}`)
  }
  if (char.group !== undefined && !/^[a-z0-9_]{1,16}$/.test(char.group)) errors.push(`${where} group: invalid`)
  const personality = join(packDir, 'personality.md')
  const performanceFile = join(packDir, 'performance.json')
  if (char.readiness === 'ready') {
    if (!existsSync(personality)) errors.push(`${where}: readiness "ready" needs personality.md`)
    if (!existsSync(performanceFile)) errors.push(`${where}: readiness "ready" needs performance.json`)
  }
  if (!existsSync(performanceFile)) return
  const perf = readJson(performanceFile)
  if (!perf) return
  const at = (what) => `${rel(performanceFile)} ${what}`
  for (const [id, gesture] of Object.entries(perf.gestures ?? {})) {
    if (!animations[gesture?.animation]) errors.push(at(`gestures.${id}: unknown animation "${gesture?.animation}"`))
    for (const emotion of gesture?.emotions ?? []) if (!emotions[emotion]) errors.push(at(`gestures.${id}: unknown emotion "${emotion}"`))
  }
  for (const [emotion, steps] of Object.entries(perf.intensityVariants ?? {})) {
    if (!emotions[emotion]) errors.push(at(`intensityVariants.${emotion}: unknown emotion`))
    for (const step of steps) if (!animations[step?.animation]) errors.push(at(`intensityVariants.${emotion}: unknown animation "${step?.animation}"`))
  }
  for (const [alias, target] of Object.entries(perf.emotionAliases ?? {})) {
    if (!emotions[target]) errors.push(at(`emotionAliases.${alias}: unknown emotion "${target}"`))
  }
  for (const [alias, target] of Object.entries(perf.reactionAliases ?? {})) {
    if (!reactions[target]) errors.push(at(`reactionAliases.${alias}: unknown reaction "${target}"`))
  }
  if (perf.errorLine !== undefined && !emotions[perf.errorLine?.emotion]) errors.push(at(`errorLine.emotion: unknown emotion "${perf.errorLine?.emotion}"`))
  const reactionNames = new Set([...Object.keys(reactions), ...Object.keys(perf.reactionAliases ?? {}), ...SFX_NAMES])
  const seen = new Set()
  for (const sig of perf.sfx?.signature ?? []) {
    const id = sig?.id
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(id)) { errors.push(at(`sfx.signature: invalid id "${id}"`)); continue }
    if (SFX_NAMES.includes(id) || seen.has(id)) errors.push(at(`sfx.signature.${id}: collides with a global or earlier sound`))
    seen.add(id)
    if (sig.performs !== undefined) {
      // Performed signatures sound through the reaction's effect cues, never a separate event.
      if (!reactions[sig.performs]) errors.push(at(`sfx.signature.${id}: performs unknown reaction "${sig.performs}"`))
      else if (!reactions[sig.performs].effect?.cues?.length) errors.push(at(`sfx.signature.${id}: reaction "${sig.performs}" has no effect cues`))
    } else if (!audio?.events?.[`sfx_${id}`]) errors.push(at(`sfx.signature.${id}: audio.json has no event "sfx_${id}"`))
    const triggers = [...(sig.reactions ?? []), ...(sig.emotions ?? [])]
    if (triggers.length === 0) errors.push(at(`sfx.signature.${id}: needs reactions or emotions`))
    for (const r of sig.reactions ?? []) if (!reactionNames.has(r)) errors.push(at(`sfx.signature.${id}: unknown reaction "${r}"`))
    for (const e of sig.emotions ?? []) if (!emotions[e]) errors.push(at(`sfx.signature.${id}: unknown emotion "${e}"`))
  }
}

// Every media file under assets must be referenced by some manifest.
for (const file of listMedia(ASSETS)) {
  if (!referenced.has(file)) errors.push(`unreferenced asset: ${file}`)
}

if (errors.length > 0) {
  console.error(`Asset validation failed with ${errors.length} error(s):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log(`Asset validation passed: ${referenced.size} referenced files, 0 errors.`)
