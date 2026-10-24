// Validates runtime asset manifests under public/assets against the filesystem.
// Usage: npm run validate:assets
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets')
const MEDIA = /\.(png|gif|webp|jpe?g|wav|mp3|ogg|m4a|flac)$/i

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
    }
  }
  for (const [reactId, reaction] of Object.entries(reactions)) {
    const frames = reaction.frames
    if (!Array.isArray(frames) || frames.length === 0) {
      errors.push(`${where} reactions.${reactId}: no frames`)
      continue
    }
    frames.forEach((f, i) => checkFile(packDir, f, `${where} reactions.${reactId}[${i}]`))
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
