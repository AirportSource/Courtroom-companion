// Validates runtime asset manifests under public/assets against the filesystem.
// Usage: npm run validate:assets
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// Node 24 strips TypeScript types natively: the runtime validators stay the single source of truth.
import { validateSoundtrackManifest } from '../src/music/soundtrack.ts'
import { validateLoopRegion } from '../src/music/loopMath.ts'
import { validateCourtRecordManifest } from '../src/courtRecord/courtRecord.ts'

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
if (soundtrack) {
  for (const error of validateSoundtrackManifest(soundtrack)) errors.push(`music/soundtrack.json ${error}`)
  for (const [id, track] of Object.entries(soundtrack.tracks ?? {})) {
    if (track?.src !== undefined) checkFile(musicDir, track.src, `music/soundtrack.json tracks.${id}`)
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
  }
  for (const f of char.unassignedFrames ?? []) checkFile(packDir, f, `${where} unassignedFrames`)

  for (const [emotion, target] of Object.entries(emotions)) {
    if (!animations[target.animation]) {
      errors.push(`${where} emotions.${emotion}: unknown animation "${target.animation}"`)
    }
    if (target.reaction !== undefined && !reactions[target.reaction]) {
      errors.push(`${where} emotions.${emotion}: unknown reaction "${target.reaction}"`)
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
