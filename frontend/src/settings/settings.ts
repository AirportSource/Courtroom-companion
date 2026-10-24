import { createContext, useContext } from 'react'
import type { MusicSourceSetting } from '../music/types.ts'

export interface Settings {
  /** Text reveal speed multiplier (1 = normal). */
  textSpeed: number
  /** Dialogue blip volume, 0–1. */
  blipVolume: number
  blipsMuted: boolean
  /** Reaction/effect SFX volume 0–1 (separate from blips and music). */
  sfxVolume: number
  sfxMuted: boolean
  /** Background-music source; 'off' plays nothing. */
  musicSource: MusicSourceSetting
  /** Master BGM volume 0–1, independent from blips/SFX. */
  musicVolume: number
  musicMuted: boolean
  /** Built-in soundtrack track id, or '' for the soundtrack profile default. */
  originalTrackId: string
  /** Imported-library track id, or '' when none is chosen. */
  importedTrackId: string
  /** YouTube video id override for the radio, or '' for the preset. */
  radioVideoId: string
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
  sfxVolume: 0.6,
  sfxMuted: false,
  musicSource: 'off',
  musicVolume: 0.5,
  musicMuted: false,
  originalTrackId: '',
  importedTrackId: '',
  radioVideoId: '',
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

const MUSIC_SOURCES: readonly MusicSourceSetting[] = ['off', 'original', 'imported', 'radio']
/** Track/video ids are opaque tokens; anything else in storage is ignored. */
const SAFE_ID = /^[A-Za-z0-9_-]{0,64}$/
const STALE_LOFI_GIRL_PRESET_ID = 'jfKfPfyJRdk'

const storedId = (value: unknown): string => (typeof value === 'string' && SAFE_ID.test(value) ? value : '')
const unitInterval = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback

/** The music part of stored settings (pure, testable). */
export function readMusicSettings(stored: Record<string, unknown>): Pick<Settings,
  'musicSource' | 'musicVolume' | 'musicMuted' | 'originalTrackId' | 'importedTrackId' | 'radioVideoId'> {
  const storedRadioId = storedId(stored.radioVideoId)
  return {
    musicSource: MUSIC_SOURCES.includes(stored.musicSource as MusicSourceSetting)
      ? (stored.musicSource as MusicSourceSetting) : DEFAULT_SETTINGS.musicSource,
    musicVolume: unitInterval(stored.musicVolume, DEFAULT_SETTINGS.musicVolume),
    musicMuted: typeof stored.musicMuted === 'boolean' ? stored.musicMuted : DEFAULT_SETTINGS.musicMuted,
    originalTrackId: storedId(stored.originalTrackId),
    importedTrackId: storedId(stored.importedTrackId),
    // Reset old saved Lofi preset selections to the current preset default.
    radioVideoId: storedRadioId === STALE_LOFI_GIRL_PRESET_ID ? '' : storedRadioId,
  }
}

const musicSnapshot = (settings: Settings) => ({
  musicSource: settings.musicSource, musicVolume: settings.musicVolume, musicMuted: settings.musicMuted,
  originalTrackId: settings.originalTrackId, importedTrackId: settings.importedTrackId,
  radioVideoId: settings.radioVideoId,
})

export function readStoredSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const stored = JSON.parse(raw) as Partial<Settings>
    return {
      textSpeed: typeof stored.textSpeed === 'number' ? stored.textSpeed : DEFAULT_SETTINGS.textSpeed,
      blipVolume: typeof stored.blipVolume === 'number' ? stored.blipVolume : DEFAULT_SETTINGS.blipVolume,
      blipsMuted: typeof stored.blipsMuted === 'boolean' ? stored.blipsMuted : DEFAULT_SETTINGS.blipsMuted,
      sfxVolume: unitInterval(stored.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
      sfxMuted: typeof stored.sfxMuted === 'boolean' ? stored.sfxMuted : DEFAULT_SETTINGS.sfxMuted,
      ...readMusicSettings(stored as Record<string, unknown>),
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
      sfxVolume: settings.sfxVolume, sfxMuted: settings.sfxMuted, ...musicSnapshot(settings), ...legacy, providerProfilesMigrated: Boolean(previous.providerProfilesMigrated),
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
      sfxVolume: settings.sfxVolume, sfxMuted: settings.sfxMuted, ...musicSnapshot(settings), providerProfilesMigrated: true,
    }))
  } catch {
    // Server-side migration is idempotent even when browser storage is unavailable.
  }
}
