import { createContext, useContext } from 'react'

export interface Settings {
  /** Text reveal speed multiplier (1 = normal). */
  textSpeed: number
  /** Dialogue blip volume, 0–1. */
  blipVolume: number
  blipsMuted: boolean
  /** Legacy migration snapshot only. Active provider configuration belongs to the backend. */
  aiProvider: 'fake' | 'ollama' | 'openai_compatible'
  ollamaBaseUrl: string
  ollamaModel: string
  openAICompatibleBaseUrl: string
  openAICompatibleModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  textSpeed: 1,
  blipVolume: 0.6,
  blipsMuted: false,
  aiProvider: 'fake',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
  openAICompatibleBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openAICompatibleModel: 'gemini-3.8-flash',
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
      aiProvider:
        stored.aiProvider === 'ollama' || stored.aiProvider === 'openai_compatible' ? stored.aiProvider : 'fake',
      ollamaBaseUrl:
        typeof stored.ollamaBaseUrl === 'string' ? stored.ollamaBaseUrl : DEFAULT_SETTINGS.ollamaBaseUrl,
      ollamaModel: typeof stored.ollamaModel === 'string' ? stored.ollamaModel : DEFAULT_SETTINGS.ollamaModel,
      openAICompatibleBaseUrl:
        typeof stored.openAICompatibleBaseUrl === 'string'
          ? stored.openAICompatibleBaseUrl
          : DEFAULT_SETTINGS.openAICompatibleBaseUrl,
      openAICompatibleModel:
        typeof stored.openAICompatibleModel === 'string'
          ? stored.openAICompatibleModel
          : DEFAULT_SETTINGS.openAICompatibleModel,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeStoredSettings(settings: Settings): void {
  try {
    const previous = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as { providerProfilesMigrated?: boolean }
    const legacy = previous.providerProfilesMigrated ? {} : {
      aiProvider: settings.aiProvider, ollamaBaseUrl: settings.ollamaBaseUrl, ollamaModel: settings.ollamaModel,
      openAICompatibleBaseUrl: settings.openAICompatibleBaseUrl, openAICompatibleModel: settings.openAICompatibleModel,
    }
    // Explicit allow-list: neither transient profile forms nor credentials can enter storage.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      textSpeed: settings.textSpeed, blipVolume: settings.blipVolume, blipsMuted: settings.blipsMuted,
      ...legacy, providerProfilesMigrated: Boolean(previous.providerProfilesMigrated),
    }))
  } catch {
    // Storage unavailable (private mode etc.): settings simply don't persist.
  }
}

export function completeProviderMigration(): void {
  try {
    const settings = readStoredSettings()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      textSpeed: settings.textSpeed, blipVolume: settings.blipVolume, blipsMuted: settings.blipsMuted,
      providerProfilesMigrated: true,
    }))
  } catch {
    // Server-side migration is idempotent even when browser storage is unavailable.
  }
}
