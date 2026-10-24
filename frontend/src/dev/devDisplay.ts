// TEMPORARY developer display options: stage scale, sprite alignment mode, debug overlay.
import { createContext, useContext } from 'react'

export type StageScaleMode = 'auto' | 1 | 2 | 3 | 4
export const STAGE_SCALE_MODES: StageScaleMode[] = [1, 2, 3, 4, 'auto']

export type AlignmentMode = 'canvas' | 'per-frame'

export const CHARACTER_SCALES = [1, 1.25, 1.5, 1.75, 2]

/** Temporary overrides of the character render profile; null = use the manifest value. */
export interface CharacterOverride {
  scale: number | null
  offsetX: number | null
  offsetY: number | null
}

export const NO_CHARACTER_OVERRIDE: CharacterOverride = { scale: null, offsetX: null, offsetY: null }

export interface DevDisplay {
  scale: StageScaleMode
  character: CharacterOverride
  /** 'canvas': manifest canvas + offsets (D-022). 'per-frame': legacy centring, for comparison. */
  alignment: AlignmentMode
  debugOverlay: boolean
}

export const DEFAULT_DEV_DISPLAY: DevDisplay = {
  scale: 'auto',
  character: NO_CHARACTER_OVERRIDE,
  alignment: 'canvas',
  debugOverlay: false,
}

export interface DevDisplayContextValue {
  display: DevDisplay
  update: (patch: Partial<DevDisplay>) => void
}

export const DevDisplayContext = createContext<DevDisplayContextValue>({
  display: DEFAULT_DEV_DISPLAY,
  update: () => {},
})

export function useDevDisplay(): DevDisplayContextValue {
  return useContext(DevDisplayContext)
}

const STORAGE_KEY = 'courtroom-companion.dev-display'

export function readStoredDevDisplay(): DevDisplay {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<DevDisplay>
    return {
      scale: STAGE_SCALE_MODES.includes(stored.scale as StageScaleMode) ? (stored.scale as StageScaleMode) : 'auto',
      character: { ...NO_CHARACTER_OVERRIDE, ...(stored.character ?? {}) },
      alignment: stored.alignment === 'per-frame' ? 'per-frame' : 'canvas',
      debugOverlay: stored.debugOverlay === true,
    }
  } catch {
    return DEFAULT_DEV_DISPLAY
  }
}

export function writeStoredDevDisplay(display: DevDisplay): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(display))
  } catch {
    // Storage unavailable: options simply don't persist.
  }
}
