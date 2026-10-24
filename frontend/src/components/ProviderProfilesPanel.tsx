import { useEffect, useState, type ReactNode } from 'react'
import { fetchOllamaModels, type OllamaModel } from '../engine/llmProviders.ts'
import {
  activateProfile, deleteProfile, duplicateProfile, loadProfiles, profileDraft, profileModels,
  removeCredential, saveCredential, saveProfile, testProfile,
  type ProfileCatalog, type ProfileDraft, type ProviderType,
} from '../settings/providerProfiles.ts'
import { readStoredSettings } from '../settings/settings.ts'

const PROVIDERS: Record<ProviderType, string> = {
  fake: 'Fake', ollama: 'Ollama', openai_compatible: 'OpenAI Compatible',
}
const TEST_MESSAGES: Record<string, string> = {
  generation_succeeded: 'Connection and generation succeeded.',
  selected_model_missing: 'The selected model is not installed.',
  auth_not_configured: 'API key is not configured.',
  auth_failed: 'Authentication failed.',
  rate_limited: 'The endpoint rate limit was reached.',
  model_error: 'The model or request was rejected.',
  structured_output_failed: 'Structured output validation failed.',
  timeout: 'The connection test timed out.',
  openai_compatible_unreachable: 'The endpoint is unreachable.',
  ollama_unreachable: 'Ollama is unreachable.',
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="settings-row settings-row-field"><span>{label}</span>{children}</label>
}

export function ProviderProfilesPanel({ characterId }: { characterId: string | null }) {
  const [catalog, setCatalog] = useState<ProfileCatalog | null>(null)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [secret, setSecret] = useState('')
  const [keyEntry, setKeyEntry] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const selected = catalog?.profiles.find((profile) => profile.id === catalog.activeProfileId)
  const fields = draft ?? (selected ? profileDraft(selected) : null)

  useEffect(() => {
    let active = true
    void loadProfiles().then((loaded) => {
      if (active) {
        setCatalog(loaded)
        if (loaded.migrationWarnings?.length) setStatus(loaded.migrationWarnings.join(' '))
      }
    }).catch((error: unknown) => {
      if (active) setStatus(error instanceof Error ? error.message : 'Could not load AI profiles.')
    })
    return () => { active = false }
  }, [])

  async function run(action: () => Promise<void>, message?: string) {
    setBusy(true)
    setStatus(null)
    try {
      await action()
      if (message) setStatus(message)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The profile operation failed.')
    } finally {
      setBusy(false)
    }
  }

  function clearTransient() {
    setDraft(null)
    setEditingId(null)
    setModels([])
    setSecret('')
    setKeyEntry(false)
    setDeleting(false)
  }

  const change = (patch: Partial<ProfileDraft>) => setDraft((current) => current ? { ...current, ...patch } : current)

  function changeType(providerType: ProviderType) {
    const legacy = readStoredSettings()
    change({
      providerType, model: null,
      baseUrl: providerType === 'ollama' ? legacy.ollamaBaseUrl : null,
      apiKeyEnv: providerType === 'openai_compatible' ? 'COURTROOM_LLM_API_KEY' : null,
    })
    setModels([])
  }

  return <section className="settings-provider" aria-label="AI profiles">
    {catalog && <Field label="AI Profile">
      <select aria-label="AI Profile" value={catalog.activeProfileId} disabled={busy || Boolean(draft)} onChange={(event) => {
        const id = event.target.value
        void run(async () => { setCatalog(await activateProfile(id)); clearTransient() })
      }}>
        {catalog.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
    </Field>}

    {catalog && !draft && <div className="settings-profile-toolbar">
      <button type="button" disabled={busy} onClick={() => { clearTransient(); setDraft(profileDraft()); setStatus(null) }}>Add</button>
      <button type="button" disabled={busy || !selected} onClick={() => {
        if (selected) { clearTransient(); setEditingId(selected.id); setDraft(profileDraft(selected)); setStatus(null) }
      }}>Edit</button>
      <button type="button" disabled={busy || !selected} onClick={() => void run(async () => {
        if (selected) { setCatalog(await activateProfile(await duplicateProfile(selected.id))); clearTransient() }
      }, 'Profile duplicated with its own credential reference.')}>Duplicate</button>
      <button type="button" disabled={busy || !selected || catalog.profiles.length < 2} onClick={() => setDeleting(true)}>Delete</button>
    </div>}

    {deleting && selected && <div className="settings-provider-actions">
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        setCatalog(await deleteProfile(selected.id)); clearTransient()
      }, 'Profile and stored key removed.')}>Confirm Delete</button>
      <button type="button" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button>
    </div>}

    {fields && <>
      <Field label="Name"><input aria-label="Profile name" value={fields.name} readOnly={!draft} disabled={busy} maxLength={80}
        onChange={(event) => change({ name: event.target.value })} /></Field>
      <Field label="Provider">
        {draft ? <select aria-label="Provider type" value={fields.providerType} disabled={busy} onChange={(event) => changeType(event.target.value as ProviderType)}>
          {Object.entries(PROVIDERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select> : <input aria-label="Provider type" readOnly value={PROVIDERS[fields.providerType]} />}
      </Field>
      {fields.providerType !== 'fake' && <>
        <Field label={fields.providerType === 'ollama' ? 'Server' : 'Base URL'}>
          <input aria-label="Profile base URL" type="url" value={fields.baseUrl ?? ''} readOnly={!draft} disabled={busy}
            onChange={(event) => change({ baseUrl: event.target.value })} />
        </Field>
        <Field label="Model">
          {draft && models.length ? <select aria-label="Profile model" value={fields.model ?? ''} disabled={busy}
            onChange={(event) => change({ model: event.target.value })}>
            <option value="">Select model</option>
            {fields.model && !models.some((model) => model.model === fields.model) && <option value={fields.model}>{fields.model}</option>}
            {models.map((model) => <option key={model.model} value={model.model}>
              {model.name}{model.parameterSize ? ` (${model.parameterSize})` : ''}
            </option>)}
          </select> : <input aria-label="Profile model" value={fields.model ?? ''} readOnly={!draft} disabled={busy}
            onChange={(event) => change({ model: event.target.value })} />}
        </Field>
      </>}

      {draft && fields.providerType === 'openai_compatible' && <Field label="Env var">
        <input aria-label="Fallback API key environment variable" value={fields.apiKeyEnv ?? ''} disabled={busy}
          placeholder="Optional" onChange={(event) => change({ apiKeyEnv: event.target.value || null })} />
      </Field>}

      {fields.providerType === 'ollama' && <div className="settings-provider-actions">
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const loaded = draft ? await fetchOllamaModels(fields.baseUrl ?? '') : selected ? await profileModels(selected.id) : []
          setModels(loaded)
          if (!draft && selected) { setEditingId(selected.id); setDraft(profileDraft(selected)) }
          setStatus(loaded.length ? `${loaded.length} installed model(s) loaded.` : 'Ollama reachable; no models installed.')
        })}>Refresh Models</button>
      </div>}

      {draft && <div className="settings-provider-actions">
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const id = await saveProfile(draft, editingId ?? undefined)
          setCatalog(await activateProfile(id)); clearTransient()
        }, 'Profile saved.')}>Save Profile</button>
        <button type="button" disabled={busy} onClick={() => { clearTransient(); setStatus(null) }}>Cancel Edit</button>
      </div>}

      {!draft && selected?.credentialRef && <>
        <div className="settings-row settings-provider-status-row"><span>API Key</span>
          <span>{selected.credentialConfigured ? 'Configured' : 'Not configured'}</span>
        </div>
        {!selected.credentialStoreAvailable && <p className="settings-provider-status">OS credential store unavailable. Environment fallback remains supported.</p>}
        {selected.credentialConfigured && !selected.storedCredentialConfigured && <p className="settings-provider-status">Using the configured environment fallback.</p>}
        <div className="settings-provider-actions">
          <button type="button" disabled={busy} onClick={() => { setSecret(''); setKeyEntry(true) }}>
            {selected.storedCredentialConfigured ? 'Replace API Key' : 'Set API Key'}
          </button>
          <button type="button" disabled={busy || !selected.storedCredentialConfigured} onClick={() => void run(async () => {
            await removeCredential(selected.id); setSecret(''); setKeyEntry(false); setCatalog(await loadProfiles())
          }, 'Stored API key removed.')}>Remove API Key</button>
        </div>
        {keyEntry && <>
          <Field label="New Key"><input aria-label="New API key" type="password" autoComplete="off" spellCheck={false}
            value={secret} disabled={busy} onChange={(event) => setSecret(event.target.value)} /></Field>
          <div className="settings-provider-actions">
            <button type="button" disabled={busy || !secret.trim()} onClick={() => void run(async () => {
              await saveCredential(selected.id, secret)
              setSecret(''); setKeyEntry(false)
              setCatalog(await loadProfiles())
            }, 'API key saved to the OS credential store.')}>Save API Key</button>
            <button type="button" disabled={busy} onClick={() => { setSecret(''); setKeyEntry(false) }}>Cancel Key</button>
          </div>
        </>}
      </>}

      {!draft && selected && <div className="settings-provider-actions">
        <button type="button" disabled={busy || !characterId} onClick={() => void run(async () => {
          if (characterId) {
            const result = await testProfile(selected.id, characterId)
            setStatus(TEST_MESSAGES[result] ?? 'Generation failed. Check profile settings.')
            setCatalog(await loadProfiles())
          }
        })}>Test Connection</button>
      </div>}
    </>}

    {busy && <p className="settings-provider-status" role="status">Working…</p>}
    {status && <p className="settings-provider-status" role="status">{status}</p>}
    {!catalog && !busy && <div className="settings-provider-actions">
      <button type="button" onClick={() => void run(async () => setCatalog(await loadProfiles()))}>Reload Profiles</button>
    </div>}
  </section>
}
