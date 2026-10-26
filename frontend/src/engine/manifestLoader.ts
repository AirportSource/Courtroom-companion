// Loads asset manifests from public/assets, validates their shape at runtime and resolves
// manifest-relative paths to URLs. Problems with individual entries become warnings and the
// entry is dropped; only an unusable manifest throws.
import { readFontMetrics, hasFontMetrics, fontFaceCss } from './fontMetrics.ts'
import { readWaiting } from './presentation.ts'
import { readTaskAcknowledgements } from './taskAcknowledgements.ts'
import { parseRingtones, ringtoneEvents, setRingtoneCatalog, type RingtoneCatalog } from './ringtones.ts'
import { parseVoices, setVoiceCatalog } from './voices.ts'
import { listableCharacters, readGroup, readReadiness } from './characterReadiness.ts'
import { readSemanticSounds, registerSemanticSounds, registerSignatureSfx } from './sfx.ts'
import type {
  FontMetricDescriptors,
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
  LoadedPresentationGroup,
  LoadedUi,
  ReactionEffect,
  Sound,
  SoundId,
  SpriteFrame,
  UiImage,
} from './manifestTypes.ts'

const DEFAULT_FPS = 6

export class ManifestError extends Error {}

function assetRoot(): URL {
  return new URL(`${import.meta.env.BASE_URL}assets/`, window.location.href)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `names`: language code → non-empty name; anything else is ignored. */
function readNames(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(
    (entry): entry is [string, string] => /^[a-z]{2}$/.test(entry[0]) && typeof entry[1] === 'string' && entry[1].trim() !== ''))
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

/** Menu art can use its own native crop while conversation/courtroom poses stay unchanged. */
export function characterPreviewPath(manifest: CharacterManifest): string | null {
  if (typeof manifest.selectionPreview === 'string' && manifest.selectionPreview.trim()) return manifest.selectionPreview
  const group = manifest.defaultPresentation ? manifest.presentationGroups?.[manifest.defaultPresentation] : undefined
  const emotions = group?.emotions ?? manifest.emotions
  const animationId = isRecord(emotions) ? emotions[group?.defaultEmotion ?? manifest.defaultEmotion]?.animation : undefined
  const firstFrame = animationId ? (group?.animations ?? manifest.animations)?.[animationId]?.idle?.frames?.[0] : undefined
  return typeof firstFrame === 'string' ? firstFrame : null
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
        const preview = characterPreviewPath(manifest)
        return {
          id,
          displayName: typeof manifest.displayName === 'string' ? manifest.displayName : id,
          names: readNames(manifest.names),
          manifestUrl,
          previewUrl: preview ? new URL(preview, manifestUrl).href : null,
          readiness: readReadiness(manifest.readiness),
          group: readGroup(manifest.group),
        }
      } catch {
        return null
      }
    }),
  )
  // asset-only packs never reach a menu; partial ones only in development builds.
  return listableCharacters(
    summaries.filter((summary): summary is CharacterSummary => summary !== null),
    Boolean(import.meta.env?.DEV),
  )
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

/** Resolves the optional Court Record portrait against the manifest URL; invalid values are ignored. */
export function readCourtRecordPortrait(raw: unknown, manifestUrl: string, warnings: string[]): UiImage | null {
  if (raw === undefined) return null
  const valid = isRecord(raw) && typeof raw.src === 'string' && raw.src !== ''
    && Number.isInteger(raw.width) && Number.isInteger(raw.height)
    && (raw.width as number) > 0 && (raw.height as number) > 0
  if (!valid) {
    warnings.push('courtRecordPortrait: expected { src, width, height }, ignoring it')
    return null
  }
  const portrait = raw as { src: string; width: number; height: number }
  try {
    return { url: new URL(portrait.src, manifestUrl).href, width: portrait.width, height: portrait.height }
  } catch {
    warnings.push('courtRecordPortrait: unresolvable src, ignoring it')
    return null
  }
}

export async function loadCharacter(manifestUrl: string): Promise<LoadedCharacter> {
  const raw = await fetchJson(new URL(manifestUrl))
  return loadCharacterData(raw, manifestUrl)
}

async function loadCharacterData(raw: unknown, manifestUrl: string, prefix = ''): Promise<LoadedCharacter> {
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
        loadClip(anim.idle, `${prefix}${id}.idle`, manifestUrl, warnings, false, anim.canvas),
        loadClip(anim.talking, `${prefix}${id}.talking`, manifestUrl, warnings, false, anim.canvas),
      ])
      if (idle || talking) animations[id] = { id, idle: idle ?? undefined, talking: talking ?? undefined }
    }),
  )

  const reactions: Record<string, AnimationClip> = {}
  await Promise.all(
    Object.entries(isRecord(manifest.reactions) ? manifest.reactions : {}).map(async ([id, clip]) => {
      const loaded = await loadClip(clip, `${prefix}reaction:${id}`, manifestUrl, warnings, true, isRecord(clip) ? clip.canvas : undefined)
      if (loaded && isRecord(clip) && clip.effect !== undefined) {
        const effect = await loadReactionEffect(clip.effect, `${prefix}reaction:${id}:effect`, manifestUrl, warnings)
        if (effect) loaded.effect = effect
      }
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

  const presentationGroups: Record<string, LoadedPresentationGroup> = {}
  for (const [context, group] of Object.entries(isRecord(manifest.presentationGroups) ? manifest.presentationGroups : {})) {
    if (!isRecord(group) || !isRecord(group.animations)) {
      warnings.push(`presentationGroups.${context}: missing animations, group dropped`)
      continue
    }
    try {
      const loaded = await loadCharacterData({
        ...manifest, ...group,
        render: { ...manifest.render, ...(isRecord(group.render) ? group.render : {}) },
        // A conversation group can refuse the shared reactions (courtroom side views, D-091).
        reactions: group.inheritReactions === false
          ? (isRecord(group.reactions) ? group.reactions : {})
          : { ...manifest.reactions, ...(isRecord(group.reactions) ? group.reactions : {}) },
        presentationGroups: undefined,
      }, manifestUrl, `presentation:${context}:`)
      presentationGroups[context] = {
        animations: loaded.animations, emotions: loaded.emotions, reactions: loaded.reactions,
        inheritReactions: group.inheritReactions !== false,
        render: loaded.render, waiting: loaded.waiting,
        defaultEmotion: loaded.defaultEmotion, fallbackEmotion: loaded.fallbackEmotion,
      }
      warnings.push(...loaded.warnings.map((warning) => `presentationGroups.${context}: ${warning}`))
    } catch (error) {
      warnings.push(`presentationGroups.${context}: ${String(error)}, group dropped`)
    }
  }

  return {
    defaultPresentation: typeof manifest.defaultPresentation === 'string' ? manifest.defaultPresentation : undefined,
    presentationGroups,
    id: typeof manifest.id === 'string' ? manifest.id : 'unknown',
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName : 'Unknown',
    names: readNames(manifest.names),
    anchor: { horizontal: 'center', vertical: 'bottom' },
    render: readRender(manifest.render, warnings),
    voice: {
      blip: typeof manifest.voice?.blip === 'string' ? manifest.voice.blip : undefined,
      // Speaker key in audio.json `voices` for this character's shouts (D-068).
      shout: typeof manifest.voice?.shout === 'string' ? manifest.voice.shout : undefined,
    },
    defaultEmotion,
    fallbackEmotion,
    animations,
    reactions,
    emotions,
    waiting: readWaiting(manifest.waiting, emotions, animations, defaultEmotion),
    taskAcknowledgements: readTaskAcknowledgements(manifest.taskAcknowledgements, emotions, defaultEmotion),
    courtRecordPortrait: readCourtRecordPortrait(manifest.courtRecordPortrait, manifestUrl, warnings),
    // Ids are checked against audio.json when it is already loaded; validate-assets checks them too.
    semanticSounds: readSemanticSounds(manifest.semanticSounds, characterSoundIds ?? undefined),
    warnings,
  }
}

/** Sound ids the audio manifest defines; set by loadAudio so packs can name character sounds. */
let characterSoundIds: ReadonlySet<string> | null = null

async function loadReactionEffect(raw: unknown, key: string, baseUrl: string, warnings: string[]): Promise<ReactionEffect | null> {
  if (!isRecord(raw)) {
    warnings.push(`${key}: not an object, ignored`)
    return null
  }
  const overlay = raw.overlay === undefined ? null
    : await loadClip(raw.overlay, `${key}:overlay`, baseUrl, warnings, true, isRecord(raw.overlay) ? raw.overlay.canvas : undefined)
  const overlayStartMs = typeof raw.overlayStartMs === 'number' && raw.overlayStartMs >= 0 ? raw.overlayStartMs : 0
  const cues = (Array.isArray(raw.cues) ? raw.cues : [])
    .filter((cue): cue is { atMs: number; event: string } => {
      const ok = isRecord(cue) && typeof cue.atMs === 'number' && Number.isFinite(cue.atMs) && cue.atMs >= 0
        && typeof cue.event === 'string' && cue.event.length > 0
      if (!ok) warnings.push(`${key}: invalid cue ignored`)
      return ok
    })
    .map(({ atMs, event }) => ({ atMs, event }))
    .sort((a, b) => a.atMs - b.atMs)
  const rawBackdrop = isRecord(raw.backdrop) ? raw.backdrop : null
  const backdrop = rawBackdrop && typeof rawBackdrop.fadeStartMs === 'number' && rawBackdrop.fadeStartMs >= 0
    && typeof rawBackdrop.fadeMs === 'number' && rawBackdrop.fadeMs >= 0
    ? {
        color: typeof rawBackdrop.color === 'string' && /^#[0-9a-f]{6}$/i.test(rawBackdrop.color) ? rawBackdrop.color : '#000000',
        fadeStartMs: rawBackdrop.fadeStartMs, fadeMs: rawBackdrop.fadeMs,
      }
    : null
  if (raw.backdrop !== undefined && !backdrop) warnings.push(`${key}: invalid backdrop ignored`)
  if (!overlay && cues.length === 0 && !backdrop) return null
  return { overlay, overlayStartMs, backdrop, cues }
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
      foregroundUrl: typeof bg.foreground === 'string' && bg.foreground ? new URL(bg.foreground, manifestUrl).href : null,
      characterOffsetY: typeof bg.characterOffsetY === 'number' && Number.isFinite(bg.characterOffsetY)
        ? Math.round(bg.characterOffsetY) : 0,
    }))
}

// ---- Audio ----

export async function loadAudio(): Promise<{ sounds: Sound[]; events: Record<string, SoundId>; ringtones: RingtoneCatalog | null }> {
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
      ...(sound.loop && Number.isFinite(sound.loop.startSeconds) && Number.isFinite(sound.loop.endSeconds)
        && sound.loop.startSeconds >= 0 && sound.loop.endSeconds > sound.loop.startSeconds
        ? { loop: sound.loop } : {}),
    }))
  const known = new Set(sounds.map((s) => s.id))
  const events: Record<string, SoundId> = {}
  for (const [event, soundId] of Object.entries(isRecord(manifest.events) ? manifest.events : {})) {
    if (typeof soundId === 'string' && known.has(soundId)) events[event] = soundId
    else console.warn(`[audio] event "${event}" maps to unknown sound "${String(soundId)}"`)
  }
  // Ringtone events are registered here so App's existing audioEngine.register(...) needs no change.
  const ringtones = parseRingtones(manifest.ringtones, known)
  if (ringtones) Object.assign(events, ringtoneEvents(ringtones))
  setRingtoneCatalog(ringtones)
  // Character signature sounds are plain audio events sfx_<id>; no id list lives in the code.
  registerSignatureSfx(Object.keys(events))
  registerSemanticSounds((raw as Record<string, unknown>).semanticSounds, known)
  characterSoundIds = known
  setVoiceCatalog(parseVoices((raw as Record<string, unknown>).voices, known))
  return { sounds, events, ringtones }
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
      const bundledFallbacks = (Array.isArray(font.fallbacks) ? font.fallbacks : [])
        .filter(
          (fallback): fallback is Record<string, unknown> & { src: string; family: string } =>
            isRecord(fallback) && typeof fallback.src === 'string' && typeof fallback.family === 'string',
        )
        .map((fallback) => ({ src: fallback.src, family: fallback.family, metrics: readFontMetrics(fallback) }))
      const fontSources = [{ src: font.src, family: font.family, metrics: {} as FontMetricDescriptors }, ...bundledFallbacks]
      await Promise.all(
        fontSources.map(async ({ src, family, metrics }) => {
          const url = new URL(src, manifestUrl).href
          if (hasFontMetrics(metrics)) {
            // @font-face so size-adjust & co apply to DOM text and canvas measurement alike.
            const style = document.createElement('style')
            style.textContent = fontFaceCss(family, url, metrics)
            document.head.append(style)
            await document.fonts.load(`16px ${JSON.stringify(family)}`, 'あ漢')
            return
          }
          document.fonts.add(await new FontFace(family, `url(${url})`).load())
        }),
      )
      ui.fonts[id] = {
        family: font.family,
        fallbackFamilies: bundledFallbacks.map(({ family }) => family),
        fallbackMetrics: Object.fromEntries(bundledFallbacks.map(({ family, metrics }) => [family, metrics])),
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
