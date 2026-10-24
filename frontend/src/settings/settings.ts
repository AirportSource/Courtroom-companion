import { createContext, useContext } from 'react'

export interface Settings {
  /** Text reveal speed multiplier (1 = normal). */
  textSpeed: number
  /** Dialogue blip volume, 0–1. */
  blipVolume: number
  blipsMuted: boolean
  aiProvider: 'fake' | 'ollama'
  ollamaBaseUrl: string
  ollamaModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  textSpeed: 1,
  blipVolume: 0.6,
  blipsMuted: false,
  aiProvider: 'fake',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
}

export const TEXT_SPEEDS = [
  { label: 'Slow', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Fast', value: 2 },
] as const

export interface SettingsContextValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
})

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext)
}

const STORAGE_KEY = 'courtroom-companion.settings'

export function readStoredSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const stored = JSON.parse(raw) as Partial<Settings>
    return {
      textSpeed: typeof stored.textSpeed === 'number' ? stored.textSpeed : DEFAULT_SETTINGS.textSpeed,
      blipVolume: typeof stored.blipVolume === 'number' ? stored.blipVolume : DEFAULT_SETTINGS.blipVolume,
      blipsMuted: typeof stored.blipsMuted === 'boolean' ? stored.blipsMuted : DEFAULT_SETTINGS.blipsMuted,
      aiProvider: stored.aiProvider === 'ollama' ? 'ollama' : 'fake',
      ollamaBaseUrl:
        typeof stored.ollamaBaseUrl === 'string' ? stored.ollamaBaseUrl : DEFAULT_SETTINGS.ollamaBaseUrl,
      ollamaModel: typeof stored.ollamaModel === 'string' ? stored.ollamaModel : DEFAULT_SETTINGS.ollamaModel,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeStoredSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable (private mode etc.): settings simply don't persist.
  }
}
