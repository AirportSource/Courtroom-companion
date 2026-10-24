import { useEffect, useState, type ReactNode } from 'react'
import { fetchOllamaModels, type OllamaModel } from '../engine/llmProviders.ts'
import {
  activateProfile, deleteProfile, duplicateProfile, loadProfiles, profileDraft, profileModels,
  removeCredential, saveCredential, saveProfile, testProfile,
  type ProfileCatalog, type ProfileDraft, type ProviderType,
} from '../settings/providerProfiles.ts'
import { readStoredSettings } from '../settings/settings.ts'
import { StageSelect } from './StageSelect.tsx'
import { generationFailureMessage } from '../engine/generation.ts'

const PROVIDERS: Record<ProviderType, string> = {
  fake: 'Fake', ollama: 'Ollama', openai_compatible: 'OpenAI Compatible', anthropic: 'Anthropic (API)',
  claude_code: 'Claude (subscription)', codex: 'ChatGPT / Codex (subscription)',
}
/** Plans used through their official CLI login (D-072): no URL, no key, model optional. */
const SUBSCRIPTIONS: ProviderType[] = ['claude_code', 'codex']
const SUBSCRIPTION_HELP: Partial<Record<ProviderType, string>> = {
  claude_code: 'Uses your Claude Pro/Max plan through Claude Code. Install it (npm install -g @anthropic-ai/claude-code) and run "claude login" once. Model: empty = default, or e.g. sonnet, haiku, opus.',
  codex: 'Uses your ChatGPT plan through the Codex CLI. Install it (npm install -g @openai/codex) and run "codex login" once. Model: empty = default.',
}
const TEST_MESSAGES: Record<string, string> = {
  generation_succeeded: 'Connection and generation succeeded.',
  selected_model_missing: 'The selected model is not installed.',
  auth_not_configured: 'Not signed in: API key missing, or run "claude login" / "codex login" for a subscription.',
  auth_failed: 'Authentication failed.',
  rate_limited: 'The endpoint rate limit was reached (or the subscription usage limit).',
  cli_not_installed: 'The CLI for this subscription is not installed or not on PATH.',
  model_error: 'The model or request was rejected.',
  structured_output_failed: 'Structured output validation failed.',
  timeout: 'The connection test timed out.',
  openai_compatible_unreachable: 'The endpoint is unreachable.',
  ollama_unreachable: 'Ollama is unreachable.',
  anthropic_unreachable: 'Anthropic is unreachable.',
  malformed_response: 'The provider returned malformed output.',
  empty_output: 'The provider returned no final output.',
  response_truncated: 'The provider returned an incomplete response.',
  output_token_limit: generationFailureMessage('output_token_limit')!,
  context_window_exceeded: generationFailureMessage('context_window_exceeded')!,
  provider_refused: 'The provider declined the request.',
  provider_limit: generationFailureMessage('provider_limit')!,
  invalid_provider_configuration: 'The provider request configuration was rejected.',
  provider_http_error: 'The provider service failed. Try again later.',
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
      apiKeyEnv: ['openai_compatible', 'anthropic'].includes(providerType) ? 'COURTROOM_LLM_API_KEY' : null,
    })
    setModels([])
  }

  return <section className="settings-provider" aria-label="AI profiles">
    {catalog && <Field label="AI Profile">
      <StageSelect label="AI Profile" value={catalog.activeProfileId} disabled={busy || Boolean(draft)}
        options={catalog.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
        onChange={(id) => void run(async () => { setCatalog(await activateProfile(id)); clearTransient() })} />
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
        {draft ? <StageSelect label="Provider type" value={fields.providerType} disabled={busy}
          options={Object.entries(PROVIDERS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => changeType(value as ProviderType)} /> : <input aria-label="Provider type" readOnly value={PROVIDERS[fields.providerType]} />}
      </Field>
      {fields.providerType !== 'fake' && <>
        {fields.providerType !== 'anthropic' && !SUBSCRIPTIONS.includes(fields.providerType) && <Field label={fields.providerType === 'ollama' ? 'Server' : 'Base URL'}>
          <input aria-label="Profile base URL" type="url" value={fields.baseUrl ?? ''} readOnly={!draft} disabled={busy}
            onChange={(event) => change({ baseUrl: event.target.value })} />
        </Field>}
        <Field label="Model">
          {draft && models.length ? <StageSelect label="Profile model" value={fields.model ?? ''} disabled={busy}
            onChange={(value) => change({ model: value })}
            options={[
              { value: '', label: 'Select model' },
              ...(fields.model && !models.some((model) => model.model === fields.model) ? [{ value: fields.model, label: fields.model }] : []),
              ...models.map((model) => ({ value: model.model, label: `${model.name}${model.parameterSize ? ` (${model.parameterSize})` : ''}` })),
            ]} /> : <input aria-label="Profile model" value={fields.model ?? ''} readOnly={!draft} disabled={busy}
            onChange={(event) => change({ model: event.target.value })} />}
        </Field>
      </>}

      {SUBSCRIPTION_HELP[fields.providerType] && <p className="settings-provider-status">{SUBSCRIPTION_HELP[fields.providerType]}</p>}

      {draft && ['openai_compatible', 'anthropic'].includes(fields.providerType) && <Field label="Env var">
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
