import type { UiImage } from '../engine/manifestTypes.ts'

/** How long an exclamation bubble stays on screen before the character speaks. */
export const EXCLAMATION_MS = 1000

/** Fetch bubble images ahead of time: they must be on screen the instant the shout plays. */
export function preloadExclamations(images: (UiImage | null | undefined)[]): void {
  for (const image of images) if (image) new Image().src = image.url
}

/** Bubble images per kind; `<kind>_ja` holds the Japanese bubble (「異議あり！」…) when available. */
export type ExclamationImages = Partial<Record<string, UiImage>>

/** The Japanese bubble for Japanese shouts (D-070), else the English one. */
export function bubbleFor(images: ExclamationImages, kind: string, japanese: boolean): UiImage | null {
  return (japanese ? images[`${kind}_ja`] : undefined) ?? images[kind] ?? null
}

/** Voice sound ids are `voice_<language>_<speaker>_<phrase>`. */
export const isJapaneseVoice = (soundId: string | null | undefined): boolean => Boolean(soundId?.startsWith('voice_ja_'))

