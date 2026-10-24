// Loads asset manifests from public/assets, validates their shape at runtime and resolves
// manifest-relative paths to URLs. Problems with individual entries become warnings and the
// entry is dropped; only an unusable manifest throws.
import type {
  AnimationClip,
  AudioManifest,
  Background,
  BackgroundsManifest,
  CharacterAnimation,
  CharacterId,
  CharacterIndexManifest,
  CharacterManifest,
  CharacterSummary,
  EmotionBindingManifest,
  LoadedCharacter,
  LoadedUi,
  Sound,
  SoundId,
  SpriteFrame,
} from './manifestTypes.ts'

const DEFAULT_FPS = 6

export class ManifestError extends Error {}

function assetRoot(): URL {
  return new URL(`${import.meta.env.BASE_URL}assets/`, window.location.href)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new ManifestError(`${url.pathname}: HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new ManifestError(`${url.pathname}: invalid JSON`)
  }
}

// Decoded images are kept referenced for the lifetime of the page so that switching
// between frames never triggers a reload (which would flicker).
const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(url)
  if (!pending) {
    const image = new Image()
    image.src = url
    pending = image.decode().then(() => image)
    pending.catch(() => imageCache.delete(url))
    imageCache.set(url, pending)
  }
  return pending
}

// ---- Character index ----

export interface CharacterIndexEntry {
  id: CharacterId
  manifestUrl: string
}

export async function loadCharacterIndex(): Promise<CharacterIndexEntry[]> {
  const indexUrl = new URL('characters/index.json', assetRoot())
  const raw = await fetchJson(indexUrl)
  if (!isRecord(raw) || !isRecord(raw.characters)) {
    throw new ManifestError('characters/index.json: missing "characters" object')
  }
  const index = raw as unknown as CharacterIndexManifest
  return Object.entries(index.characters)
    .filter(([, path]) => typeof path === 'string')
    .map(([id, path]) => ({ id, manifestUrl: new URL(path, indexUrl).href }))
}

/** Reads each registered manifest's JSON (no image decoding) for menu listings. */
export async function loadCharacterSummaries(): Promise<CharacterSummary[]> {
  const index = await loadCharacterIndex()
  const summaries = await Promise.all(
    index.map(async ({ id, manifestUrl }): Promise<CharacterSummary | null> => {
      try {
        const raw = await fetchJson(new URL(manifestUrl))
        if (!isRecord(raw)) return null
        const manifest = raw as unknown as CharacterManifest
        const animationId = isRecord(manifest.emotions)
          ? manifest.emotions[manifest.defaultEmotion]?.animation
          : undefined
        const firstFrame = animationId ? manifest.animations?.[animationId]?.idle?.frames?.[0] : undefined
        return {
          id,
          displayName: typeof manifest.displayName === 'string' ? manifest.displayName : id,
          manifestUrl,
          previewUrl: typeof firstFrame === 'string' ? new URL(firstFrame, manifestUrl).href : null,
        }
      } catch {
        return null
      }
    }),
  )
  return summaries.filter((summary): summary is CharacterSummary => summary !== null)
}

// ---- Character manifest ----

async function loadClip(
  raw: unknown,
  key: string,
  baseUrl: string,
  warnings: string[],
  forceOneShot: boolean,
  canvasRaw: unknown,
): Promise<AnimationClip | null> {
  if (!isRecord(raw) || !Array.isArray(raw.frames)) {
    warnings.push(`${key}: missing frame list`)
    return null
  }
  let fps = DEFAULT_FPS
  if (typeof raw.fps === 'number' && raw.fps > 0) fps = raw.fps
  else warnings.push(`${key}: invalid fps, using ${DEFAULT_FPS}`)

  let loop = raw.loop === true
  if (forceOneShot && loop) {
    warnings.push(`${key}: reactions are one-shot; ignoring loop: true`)
    loop = false
  }

  const offsets = readOffsets(raw.offsets, raw.frames.length, key, warnings)
  const durations = readDurations(raw.frameDurations, raw.frames.length, key, warnings)
  const holdJitterMs = typeof raw.holdJitterMs === 'number' && raw.holdJitterMs > 0 ? raw.holdJitterMs : 0

  const frames = await Promise.all(
    raw.frames.map(async (path, index): Promise<SpriteFrame | null> => {
      if (typeof path !== 'string') return null
      const url = new URL(path, baseUrl).href
      try {
        const image = await loadImage(url)
        const [x, y] = offsets?.[index] ?? [0, 0]
        return { path, url, width: image.naturalWidth, height: image.naturalHeight, x, y, durationMs: durations?.[index] }
      } catch {
        warnings.push(`${key}: frame failed to load: ${path}`)
        return null
      }
    }),
  )
  const loaded = frames.filter((frame): frame is SpriteFrame => frame !== null)
  if (loaded.length === 0) {
    warnings.push(`${key}: no usable frames`)
    return null
  }

  const canvas = readCanvas(canvasRaw)
  if (offsets && canvas) {
    const fits = loaded.every((f) => f.x + f.width <= canvas.width && f.y + f.height <= canvas.height)
    if (fits) return { key, fps, loop, frames: loaded, canvas, aligned: true, holdJitterMs }
    warnings.push(`${key}: frames exceed canvas, using per-frame bottom-centre placement`)
  } else if (offsets || canvasRaw !== undefined) {
    warnings.push(`${key}: canvas/offsets incomplete, using per-frame bottom-centre placement`)
  }
  return { key, fps, loop, ...bottomCentred(loaded), aligned: false, holdJitterMs }
}

function readDurations(raw: unknown, count: number, key: string, warnings: string[]): number[] | null {
  if (raw === undefined) return null
  if (Array.isArray(raw) && raw.length === count && raw.every((d) => typeof d === 'number' && d > 0)) {
    return raw as number[]
  }
  warnings.push(`${key}: invalid frameDurations, using fps`)
  return null
}

function readRender(raw: unknown, warnings: string[]): { scale: number; offsetX: number; offsetY: number } {
  const render = { scale: 1, offsetX: 0, offsetY: 0 }
  if (raw === undefined) return render
  if (!isRecord(raw)) {
    warnings.push('render: not an object, using defaults')
    return render
  }
  if (typeof raw.scale === 'number' && raw.scale > 0) render.scale = raw.scale
  else if (raw.scale !== undefined) warnings.push('render.scale: invalid, using 1')
  if (Number.isInteger(raw.offsetX)) render.offsetX = raw.offsetX as number
  if (Number.isInteger(raw.offsetY)) render.offsetY = raw.offsetY as number
  return render
}

function readCanvas(raw: unknown): { width: number; height: number } | null {
  if (!isRecord(raw)) return null
  const { width, height } = raw
  return Number.isInteger(width) && Number.isInteger(height) && (width as number) > 0 && (height as number) > 0
    ? { width: width as number, height: height as number }
    : null
}

function readOffsets(raw: unknown, count: number, key: string, warnings: string[]): [number, number][] | null {
  if (raw === undefined) return null
  const valid =
    Array.isArray(raw) &&
    raw.length === count &&
    raw.every((o) => Array.isArray(o) && o.length === 2 && o.every((n) => Number.isInteger(n) && n >= 0))
  if (!valid) {
    warnings.push(`${key}: invalid offsets, ignoring them`)
    return null
  }
  return raw as [number, number][]
}

/** Legacy placement: canvas = largest frame, each frame bottom-centred inside it. */
function bottomCentred(frames: SpriteFrame[]): { frames: SpriteFrame[]; canvas: { width: number; height: number } } {
  const width = Math.max(...frames.map((f) => f.width))
  const height = Math.max(...frames.map((f) => f.height))
  return {
    canvas: { width, height },
    frames: frames.map((f) => ({ ...f, x: Math.floor((width - f.width) / 2), y: height - f.height })),
  }
}

export async function loadCharacter(manifestUrl: string): Promise<LoadedCharacter> {
  const raw = await fetchJson(new URL(manifestUrl))
  if (!isRecord(raw) || !isRecord(raw.animations) || !isRecord(raw.emotions)) {
    throw new ManifestError(`${manifestUrl}: missing "animations" or "emotions"`)
  }
  const manifest = raw as unknown as CharacterManifest
  const warnings: string[] = []

  if (manifest.anchor !== undefined && manifest.anchor !== 'bottom-center') {
    warnings.push(`anchor "${manifest.anchor}" unsupported, using bottom-center`)
  }

  const animations: Record<string, CharacterAnimation> = {}
  await Promise.all(
    Object.entries(manifest.animations).map(async ([id, anim]) => {
      if (!isRecord(anim)) {
        warnings.push(`animations.${id}: not an object`)
        return
      }
      const [idle, talking] = await Promise.all([
        loadClip(anim.idle, `${id}.idle`, manifestUrl, warnings, false, anim.canvas),
        loadClip(anim.talking, `${id}.talking`, manifestUrl, warnings, false, anim.canvas),
      ])
      if (idle || talking) animations[id] = { id, idle: idle ?? undefined, talking: talking ?? undefined }
    }),
  )

  const reactions: Record<string, AnimationClip> = {}
  await Promise.all(
    Object.entries(isRecord(manifest.reactions) ? manifest.reactions : {}).map(async ([id, clip]) => {
      const loaded = await loadClip(clip, `reaction:${id}`, manifestUrl, warnings, true, isRecord(clip) ? clip.canvas : undefined)
      if (loaded) reactions[id] = loaded
    }),
  )

  const emotions: Record<string, EmotionBindingManifest> = {}
  for (const [emotion, binding] of Object.entries(manifest.emotions)) {
    if (!isRecord(binding) || typeof binding.animation !== 'string' || !animations[binding.animation]) {
      warnings.push(`emotions.${emotion}: animation unavailable, emotion dropped`)
      continue
    }
    const reaction = typeof binding.reaction === 'string' ? binding.reaction : undefined
    if (reaction !== undefined && !reactions[reaction]) {
      warnings.push(`emotions.${emotion}: reaction "${reaction}" unavailable, ignoring it`)
    }
    emotions[emotion] = {
      animation: binding.animation,
      reaction: reaction !== undefined && reactions[reaction] ? reaction : undefined,
    }
  }

  const emotionIds = Object.keys(emotions)
  if (emotionIds.length === 0) throw new ManifestError(`${manifestUrl}: no usable emotions`)

  const pickEmotion = (requested: unknown, field: string): string => {
    if (typeof requested === 'string' && emotions[requested]) return requested
    warnings.push(`${field} "${String(requested)}" unavailable, using "${emotionIds[0]}"`)
    return emotionIds[0]
  }
  const fallbackEmotion = pickEmotion(manifest.fallbackEmotion, 'fallbackEmotion')
  const defaultEmotion =
    typeof manifest.defaultEmotion === 'string' && emotions[manifest.defaultEmotion]
      ? manifest.defaultEmotion
      : fallbackEmotion

  return {
    id: typeof manifest.id === 'string' ? manifest.id : 'unknown',
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName : 'Unknown',
    anchor: { horizontal: 'center', vertical: 'bottom' },
    render: readRender(manifest.render, warnings),
    voice: { blip: typeof manifest.voice?.blip === 'string' ? manifest.voice.blip : undefined },
    defaultEmotion,
    fallbackEmotion,
    animations,
    reactions,
    emotions,
    warnings,
  }
}

// ---- Backgrounds ----

export async function loadBackgrounds(): Promise<Background[]> {
  const manifestUrl = new URL('backgrounds/backgrounds.json', assetRoot())
  const raw = await fetchJson(manifestUrl)
  if (!isRecord(raw) || !isRecord(raw.backgrounds)) {
    throw new ManifestError('backgrounds.json: missing "backgrounds" object')
  }
  const manifest = raw as unknown as BackgroundsManifest
  return Object.entries(manifest.backgrounds)
    .filter(([, bg]) => isRecord(bg) && typeof bg.src === 'string')
    .map(([id, bg]) => ({
      id,
      url: new URL(bg.src, manifestUrl).href,
      width: typeof bg.width === 'number' ? bg.width : 0,
      height: typeof bg.height === 'number' ? bg.height : 0,
      description: bg.description ?? '',
      notes: bg.notes,
    }))
}

// ---- Audio ----

export async function loadAudio(): Promise<{ sounds: Sound[]; events: Record<string, SoundId> }> {
  const manifestUrl = new URL('audio/audio.json', assetRoot())
  const raw = await fetchJson(manifestUrl)
  if (!isRecord(raw) || !isRecord(raw.sounds)) {
    throw new ManifestError('audio.json: missing "sounds" object')
  }
  const manifest = raw as unknown as AudioManifest
  const sounds = Object.entries(manifest.sounds)
    .filter(([, sound]) => isRecord(sound) && typeof sound.src === 'string')
    .map(([id, sound]) => ({
      id,
      category: typeof sound.category === 'string' ? sound.category : 'unknown',
      url: new URL(sound.src, manifestUrl).href,
    }))
  const known = new Set(sounds.map((s) => s.id))
  const events: Record<string, SoundId> = {}
  for (const [event, soundId] of Object.entries(isRecord(manifest.events) ? manifest.events : {})) {
    if (typeof soundId === 'string' && known.has(soundId)) events[event] = soundId
    else console.warn(`[audio] event "${event}" maps to unknown sound "${String(soundId)}"`)
  }
  return { sounds, events }
}

// ---- UI (fonts + images) ----

/** Loads ui.json and registers its fonts with the document (FontFace API). */
export async function loadUi(): Promise<LoadedUi> {
  const manifestUrl = new URL('ui/ui.json', assetRoot())
  const raw = await fetchJson(manifestUrl)
  if (!isRecord(raw)) throw new ManifestError('ui.json: not an object')
  const ui: LoadedUi = { fonts: {}, images: {} }

  for (const [id, font] of Object.entries(isRecord(raw.fonts) ? raw.fonts : {})) {
    if (!isRecord(font) || typeof font.src !== 'string' || typeof font.family !== 'string') continue
    try {
      const bundledFallbacks = (Array.isArray(font.fallbacks) ? font.fallbacks : []).filter(
        (fallback): fallback is { src: string; family: string } =>
          isRecord(fallback) && typeof fallback.src === 'string' && typeof fallback.family === 'string',
      )
      const fontSources = [{ src: font.src, family: font.family }, ...bundledFallbacks]
      const faces = await Promise.all(
        fontSources.map(({ src, family }) => new FontFace(family, `url(${new URL(src, manifestUrl).href})`).load()),
      )
      faces.forEach((face) => document.fonts.add(face))
      ui.fonts[id] = {
        family: font.family,
        fallbackFamilies: bundledFallbacks.map(({ family }) => family),
        pixelSize: typeof font.pixelSize === 'number' ? font.pixelSize : 16,
        letterSpacing: typeof font.letterSpacing === 'number' ? font.letterSpacing : 0,
        wordSpacing: typeof font.wordSpacing === 'number' ? font.wordSpacing : 0,
      }
    } catch {
      console.warn(`[ui] font "${id}" failed to load; using the fallback font`)
    }
  }

  for (const [id, image] of Object.entries(isRecord(raw.images) ? raw.images : {})) {
    if (!isRecord(image) || typeof image.src !== 'string') continue
    ui.images[id] = {
      url: new URL(image.src, manifestUrl).href,
      width: typeof image.width === 'number' ? image.width : 0,
      height: typeof image.height === 'number' ? image.height : 0,
    }
  }
  return ui
}
