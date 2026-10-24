import { backendJson, modelsFrom } from '../engine/llmProviders.ts'
import { readStoredSettings, completeProviderMigration } from './settings.ts'

export type ProviderType = 'fake' | 'ollama' | 'openai_compatible' | 'anthropic' | 'claude_code' | 'codex'
export interface ProfileDraft {
  name: string
  providerType: ProviderType
  baseUrl: string | null
  model: string | null
  apiKeyEnv: string | null
  generationSettings: { temperature: number; max_tokens: number; timeout_s: number }
}
export interface ProviderProfile extends ProfileDraft {
  id: string
  credentialRef: string | null
  credentialConfigured: boolean
  storedCredentialConfigured: boolean
  credentialStoreAvailable: boolean
}
export interface ProfileCatalog {
  activeProfileId: string
  profiles: ProviderProfile[]
  migrationWarnings?: string[]
}

const ROOT = '/api/provider-profiles'
let migration: Promise<void> | null = null
let migrationWarnings: string[] = []

function jsonRequest(method: string, value?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) }
}

/** Import old non-secret browser settings once; subsequent selection belongs to the server. */
export function initializeProviderProfiles(): Promise<void> {
  if (!migration) {
    const legacy = readStoredSettings()
    migration = backendJson(`${ROOT}/import-legacy`, jsonRequest('POST', {
      aiProvider: legacy.aiProvider,
      ollamaBaseUrl: legacy.ollamaBaseUrl,
      ollamaModel: legacy.ollamaModel,
      openAICompatibleBaseUrl: legacy.openAICompatibleBaseUrl,
      openAICompatibleModel: legacy.openAICompatibleModel,
    }), 15_000).then((result) => {
      migrationWarnings = Array.isArray(result.migrationWarnings) ? result.migrationWarnings.filter((value): value is string => typeof value === 'string') : []
      if (migrationWarnings.length === 0) completeProviderMigration()
    }).catch((error) => {
      migration = null
      throw error
    })
  }
  return migration
}

function catalogFrom(raw: Record<string, unknown>): ProfileCatalog {
  if (typeof raw.activeProfileId !== 'string' || !Array.isArray(raw.profiles)) throw new Error('Invalid profile list.')
  const profiles = raw.profiles as ProviderProfile[]
  if (!profiles.every((profile) => typeof profile.id === 'string' && typeof profile.name === 'string'
    && ['fake', 'ollama', 'openai_compatible', 'anthropic', 'claude_code', 'codex'].includes(profile.providerType)
    && typeof profile.credentialConfigured === 'boolean') || !profiles.some((profile) => profile.id === raw.activeProfileId)) {
    throw new Error('Invalid profile list.')
  }
  return { activeProfileId: raw.activeProfileId, profiles }
}

export async function loadProfiles(): Promise<ProfileCatalog> {
  await initializeProviderProfiles()
  return { ...catalogFrom(await backendJson(ROOT, {}, 15_000)), migrationWarnings }
}

export async function activateProfile(id: string): Promise<ProfileCatalog> {
  return catalogFrom(await backendJson(`${ROOT}/${encodeURIComponent(id)}/activate`, jsonRequest('POST'), 15_000))
}

export async function saveProfile(draft: ProfileDraft, id?: string): Promise<string> {
  const result = await backendJson(id ? `${ROOT}/${encodeURIComponent(id)}` : ROOT, jsonRequest(id ? 'PUT' : 'POST', draft), 15_000)
  if (typeof result.id !== 'string') throw new Error('Invalid saved profile.')
  return result.id
}

export async function duplicateProfile(id: string): Promise<string> {
  const result = await backendJson(`${ROOT}/${encodeURIComponent(id)}/duplicate`, jsonRequest('POST'), 15_000)
  if (typeof result.id !== 'string') throw new Error('Invalid duplicated profile.')
  return result.id
}

export async function deleteProfile(id: string): Promise<ProfileCatalog> {
  return catalogFrom(await backendJson(`${ROOT}/${encodeURIComponent(id)}`, jsonRequest('DELETE'), 15_000))
}

export async function saveCredential(id: string, secret: string): Promise<void> {
  await backendJson(`${ROOT}/${encodeURIComponent(id)}/credential`, jsonRequest('PUT', { secret }), 15_000)
}

export async function removeCredential(id: string): Promise<void> {
  await backendJson(`${ROOT}/${encodeURIComponent(id)}/credential`, jsonRequest('DELETE'), 15_000)
}

export async function profileModels(id: string) {
  return modelsFrom(await backendJson(`${ROOT}/${encodeURIComponent(id)}/models`, {}, 15_000))
}

export async function testProfile(id: string, character: string): Promise<string> {
  const result = await backendJson(`${ROOT}/${encodeURIComponent(id)}/test`, jsonRequest('POST', { character }), 135_000)
  return typeof result.status === 'string' ? result.status : 'generation_failed'
}

export function profileDraft(profile?: ProviderProfile): ProfileDraft {
  return profile ? {
    name: profile.name, providerType: profile.providerType, baseUrl: profile.baseUrl, model: profile.model,
    apiKeyEnv: profile.apiKeyEnv, generationSettings: { ...profile.generationSettings },
  } : {
    name: 'New profile', providerType: 'fake', baseUrl: null, model: null, apiKeyEnv: null,
    generationSettings: { temperature: 0.7, max_tokens: 600, timeout_s: 120 },
  }
}
