import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, readStoredSettings, writeStoredSettings, completeProviderMigration } from '../src/settings/settings.ts'
import { activateProfile, loadProfiles, profileDraft, saveCredential, saveProfile, testProfile } from '../src/settings/providerProfiles.ts'

const storage = new Map<string, string>()
const storageKey = 'courtroom-companion.settings'
const browser = {
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  setTimeout, clearTimeout,
}
Object.defineProperty(globalThis, 'window', { value: browser, configurable: true })

test('browser settings retain migration metadata until import, then persist only presentation preferences', () => {
  storage.clear()
  writeStoredSettings({ ...DEFAULT_SETTINGS, aiProvider: 'ollama', ollamaModel: 'qwen:legacy', secret: 'synthetic-unwanted-value' } as typeof DEFAULT_SETTINGS)
  assert.equal(readStoredSettings().ollamaModel, 'qwen:legacy')
  assert.ok(!storage.get(storageKey)!.includes('synthetic-unwanted-value'))
  completeProviderMigration()
  writeStoredSettings({ ...DEFAULT_SETTINGS, textSpeed: 2 })
  assert.deepEqual(JSON.parse(storage.get(storageKey)!), {
    textSpeed: 2, blipVolume: 0.6, blipsMuted: false, providerProfilesMigrated: true,
  })
})

test('native Anthropic profile metadata uses the existing profile and credential API without a base URL', async () => {
  const originalFetch = globalThis.fetch
  const profile = {
    ...profileDraft(), id: 'native-profile', name: 'Claude', providerType: 'anthropic' as const,
    baseUrl: null, model: 'claude-test-model', apiKeyEnv: 'TEST_NATIVE_KEY',
    credentialRef: 'courtroom:profile:native-profile', credentialConfigured: true,
    storedCredentialConfigured: true, credentialStoreAvailable: true,
  }
  const requests: { path: string; init?: RequestInit }[] = []
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    const body = init?.method === 'POST' && path === '/api/provider-profiles' ? profile
      : { activeProfileId: profile.id, profiles: [profile], migrationWarnings: [] }
    return new Response(JSON.stringify(body))
  }
  try {
    const loaded = await activateProfile(profile.id)
    assert.equal(loaded.profiles[0].providerType, 'anthropic')
    assert.equal(loaded.profiles[0].credentialConfigured, true)
    assert.equal(await saveProfile(profileDraft(profile)), profile.id)
    const saved = JSON.parse(String(requests.at(-1)!.init!.body))
    assert.equal(saved.baseUrl, null)
    assert.equal(saved.model, 'claude-test-model')
    assert.equal(saved.providerType, 'anthropic')
    assert.ok(!('credentialRef' in saved) && !('secret' in saved))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('profile APIs migrate once, switch on the server, and send a credential only to its write endpoint', async () => {
  storage.clear()
  writeStoredSettings({ ...DEFAULT_SETTINGS, aiProvider: 'ollama', ollamaModel: 'qwen:legacy' })
  const calls: { path: string; body: unknown; method: string }[] = []
  const originalFetch = globalThis.fetch
  const profile = {
    id: 'profile-test', name: 'Generic', providerType: 'openai_compatible' as const,
    baseUrl: 'https://compatible.example/v1', model: 'test-model', apiKeyEnv: null,
    generationSettings: { temperature: 0.7, max_tokens: 600, timeout_s: 120 },
    credentialRef: 'courtroom:profile:profile-test', credentialConfigured: true,
    storedCredentialConfigured: true, credentialStoreAvailable: true,
  }
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    const response = path.endsWith('/credential') ? { credentialConfigured: true }
      : path.endsWith('/test') ? { status: 'generation_succeeded' }
        : { activeProfileId: profile.id, profiles: [profile], migrationWarnings: [] }
    return new Response(JSON.stringify(response), { status: 200 })
  }
  try {
    await loadProfiles()
    await loadProfiles()
    assert.equal(calls.filter((call) => call.path.endsWith('/import-legacy')).length, 1)
    assert.equal((calls[0].body as Record<string, string>).ollamaModel, 'qwen:legacy')
    assert.ok(!storage.get(storageKey)!.includes('ollamaModel'))
    await activateProfile(profile.id)
    assert.ok(calls.some((call) => call.path.endsWith('/profile-test/activate')))
    const secret = 'synthetic-browser-entry'
    await saveCredential(profile.id, secret)
    assert.equal(calls.filter((call) => JSON.stringify(call.body).includes(secret)).length, 1)
    assert.ok(calls.at(-1)!.path.endsWith('/profile-test/credential'))
    assert.equal(await testProfile(profile.id, 'maya_fey'), 'generation_succeeded')
    assert.deepEqual(calls.at(-1)!.body, { character: 'maya_fey' })
    assert.ok(!storage.get(storageKey)!.includes(secret))
    assert.deepEqual(Object.keys(profileDraft(profile)).sort(),
      ['apiKeyEnv', 'baseUrl', 'generationSettings', 'model', 'name', 'providerType'].sort())
  } finally {
    globalThis.fetch = originalFetch
  }
})
