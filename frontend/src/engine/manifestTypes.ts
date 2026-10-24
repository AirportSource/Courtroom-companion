// Shapes of the JSON manifests under public/assets (schema v1, see docs/DECISIONS.md D-011)
// and of the resolved, ready-to-render data produced by the loader.
// Logical IDs (emotions, animations, backgrounds) are plain strings: the set of valid
// values lives in the manifests, never in TypeScript.

export type EmotionId = string
export type AnimationId = string
export type ReactionId = string
export type BackgroundId = string
export type CharacterId = string
export type SoundId = string

export type TalkMode = 'idle' | 'talking'

// ---- Raw manifest JSON ----

export interface CharacterIndexManifest {
  schemaVersion: number
  characters: Record<CharacterId, string>
}

export interface CanvasSize {
  width: number
  height: number
}

export interface ClipManifest {
  fps: number
  loop: boolean
  frames: string[]
  /** Per-frame [x, y] position inside the canvas (same length as frames). */
  offsets?: [number, number][]
  /** Per-frame display time in ms (same length as frames); overrides fps. */
  frameDurations?: number[]
  /** Random extra 0..N ms added to the first frame on every loop (e.g. irregular blinks). */
  holdJitterMs?: number
}

/** Optional shared canvas: frames are placed at their offsets inside it, and the canvas
 * (not each frame) is anchored on stage, so tightly cropped frames don't jitter. */
export interface AnimationManifest {
  canvas?: CanvasSize
  idle?: ClipManifest
  talking?: ClipManifest
}

export interface ReactionManifest extends ClipManifest {
  canvas?: CanvasSize
}

export interface EmotionBindingManifest {
  animation: AnimationId
  reaction?: ReactionId
}

/** How a character is placed in the 256×192 scene (D-026). */
export interface CharacterRender {
  /** Sprite scale; 1 = native DS pixels (non-integer values distort pixel art). */
  scale: number
  /** Stage-pixel shift of the bottom-centre anchor. */
  offsetX: number
  offsetY: number
}

export interface CharacterManifest {
  schemaVersion: number
  id: CharacterId
  displayName: string
  anchor?: string
  render?: Partial<CharacterRender>
  voice?: { blip?: string }
  defaultEmotion: EmotionId
  fallbackEmotion: EmotionId
  animations: Record<AnimationId, AnimationManifest>
  reactions?: Record<ReactionId, ReactionManifest>
  emotions: Record<EmotionId, EmotionBindingManifest>
  unassignedFrames?: string[]
}

export interface BackgroundEntryManifest {
  src: string
  width: number
  height: number
  description?: string
  notes?: string
}

export interface BackgroundsManifest {
  schemaVersion: number
  backgrounds: Record<BackgroundId, BackgroundEntryManifest>
}

export interface AudioManifest {
  schemaVersion: number
  categories: string[]
  sounds: Record<SoundId, { category: string; src: string }>
  /** Logical event name (e.g. "menu_cursor") → sound id. */
  events?: Record<string, SoundId>
}

// ---- Resolved data ----

export interface SpriteFrame {
  /** Path as written in the manifest (for diagnostics only). */
  path: string
  url: string
  width: number
  height: number
  /** Position of the frame's top-left inside its clip canvas. */
  x: number
  y: number
  /** Display time in ms when the manifest sets one; otherwise the clip fps applies. */
  durationMs?: number
}

export interface AnimationClip {
  /** e.g. "neutral_front.idle" or "reaction:shocked" */
  key: string
  fps: number
  loop: boolean
  frames: SpriteFrame[]
  /** Canvas the frames are placed in. Without manifest data this is the largest frame
   * size and every frame is bottom-centred in it (legacy per-frame placement). */
  canvas: CanvasSize
  /** True when canvas/offsets came from the manifest. */
  aligned: boolean
  /** Random extra 0..N ms on the first frame of each loop (0 = none). */
  holdJitterMs: number
}

export interface CharacterAnimation {
  id: AnimationId
  idle?: AnimationClip
  talking?: AnimationClip
}

export interface CharacterAnchor {
  horizontal: 'center'
  vertical: 'bottom'
}

export interface LoadedCharacter {
  id: CharacterId
  displayName: string
  anchor: CharacterAnchor
  render: CharacterRender
  voice: { blip?: SoundId }
  defaultEmotion: EmotionId
  fallbackEmotion: EmotionId
  animations: Record<AnimationId, CharacterAnimation>
  reactions: Record<ReactionId, AnimationClip>
  emotions: Record<EmotionId, EmotionBindingManifest>
  /** Non-fatal problems found while loading (missing frames, bad references...). */
  warnings: string[]
}

export interface UiFont {
  family: string
  /** Size (CSS px, i.e. stage px) at which one font pixel = one stage pixel. */
  pixelSize: number
  /** Letter spacing (px at pixelSize) that keeps glyph advances on whole pixels. */
  letterSpacing: number
  /** Extra space width (px); the font's own space glyph is very narrow. */
  wordSpacing: number
}

export interface UiImage {
  url: string
  width: number
  height: number
}

export interface LoadedUi {
  fonts: Record<string, UiFont>
  images: Record<string, UiImage>
}

/** Lightweight listing entry for menus; the full character is loaded on selection. */
export interface CharacterSummary {
  id: CharacterId
  displayName: string
  manifestUrl: string
  /** First idle frame of the default emotion, if resolvable. */
  previewUrl: string | null
}

export interface Sound {
  id: SoundId
  category: string
  url: string
}

export interface Background {
  id: BackgroundId
  url: string
  width: number
  height: number
  description: string
  notes?: string
}
