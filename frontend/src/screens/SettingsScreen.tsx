import { useEffect, useState } from 'react'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import {
  fetchOllamaModels,
  ProviderApiError,
  testOllamaConnection,
  type OllamaModel,
} from '../engine/llmProviders.ts'
import type { SoundId, UiImage } from '../engine/manifestTypes.ts'
import { TEXT_SPEEDS, useSettings } from '../settings/settings.ts'

interface SettingsScreenProps {
  /** Blip used for the "test" button (first blip sound in audio.json). */
  previewBlip: SoundId | null
  /** Character definition used only to build the provider-independent schema test prompt. */
  testCharacterId: string | null
  onBack: () => void
  /** Original DS panel behind the settings (ui.json); CSS gradient fallback when absent. */
  backdrop: UiImage | null
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof ProviderApiError) {
    if (error.code === 'ollama_unreachable') return 'Ollama unreachable.'
    if (error.code === 'timeout') return 'Ollama timed out.'
    if (error.code === 'invalid_base_url') return 'Invalid Ollama server URL.'
    return error.message
  }
  return error instanceof Error ? error.message : 'Connection check failed.'
}

function modelLabel(model: OllamaModel): string {
  const details = [model.parameterSize, model.quantizationLevel].filter(Boolean).join(', ')
  return details ? `${model.name} (${details})` : model.name
}

export function SettingsScreen({ previewBlip, testCharacterId, onBack, backdrop }: SettingsScreenProps) {
  const { settings, update: updateSettings } = useSettings()
  const [models, setModels] = useState<OllamaModel[]>([])
  const [providerBusy, setProviderBusy] = useState<'refresh' | 'test' | null>(null)
  const [providerStatus, setProviderStatus] = useState<string | null>(null)
  const update = (patch: Parameters<typeof updateSettings>[0]) => {
    playMenuSound('menu_confirm')
    updateSettings(patch)
  }
  const back = () => {
    playMenuSound('menu_cancel')
    onBack()
  }

  useEffect(() => {
    if (previewBlip) audioEngine.preload([previewBlip])
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        playMenuSound('menu_cancel')
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewBlip, onBack])

  const testBlip = () => {
    audioEngine.unlock()
    if (previewBlip && !settings.blipsMuted) audioEngine.play(previewBlip, settings.blipVolume)
  }

  const refreshModels = async () => {
    setProviderBusy('refresh')
    setProviderStatus('Checking Ollama…')
    try {
      const loaded = await fetchOllamaModels(settings.ollamaBaseUrl)
      setModels(loaded)
      if (!settings.ollamaModel && loaded[0]) updateSettings({ ollamaModel: loaded[0].model })
      setProviderStatus(
        loaded.length ? `Ollama reachable; ${loaded.length} model${loaded.length === 1 ? '' : 's'} loaded.` : 'Ollama reachable; no models installed.',
      )
    } catch (error) {
      setModels([])
      setProviderStatus(providerErrorMessage(error))
    } finally {
      setProviderBusy(null)
    }
  }

  const testConnection = async () => {
    if (!settings.ollamaModel) {
      setProviderStatus('Select an installed model first.')
      return
    }
    if (!testCharacterId) {
      setProviderStatus('No character is available for the generation test.')
      return
    }
    setProviderBusy('test')
    setProviderStatus('Testing generation…')
    try {
      const result = await testOllamaConnection(settings.ollamaBaseUrl, settings.ollamaModel, testCharacterId)
      setModels(result.models)
      if (result.status === 'selected_model_missing') setProviderStatus('Ollama reachable; selected model is missing.')
      else if (result.status === 'generation_succeeded') setProviderStatus('Ollama reachable; generation test succeeded.')
      else setProviderStatus(`Ollama reachable; generation failed (${result.error ?? 'invalid output'}).`)
    } catch (error) {
      setProviderStatus(providerErrorMessage(error))
    } finally {
      setProviderBusy(null)
    }
  }

  return (
    <PixelStage>
      <StageBackdrop image={backdrop} />
      <div className={`menu-screen settings-screen ${backdrop ? 'menu-screen-overlay' : 'menu-screen-plain'}`}>
        <h1 className="menu-heading">Settings</h1>

        <div className="settings-row">
          <span>AI Provider</span>
          <div className="settings-options">
            {(['fake', 'ollama'] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                aria-pressed={settings.aiProvider === provider}
                onClick={() => update({ aiProvider: provider })}
              >
                {provider === 'fake' ? 'Fake' : 'Ollama'}
              </button>
            ))}
          </div>
        </div>

        {settings.aiProvider === 'ollama' && (
          <div className="settings-provider">
            <label className="settings-row settings-row-field">
              <span>Server</span>
              <input
                type="url"
                value={settings.ollamaBaseUrl}
                onChange={(event) => updateSettings({ ollamaBaseUrl: event.target.value })}
                aria-label="Ollama server"
              />
            </label>
            <label className="settings-row settings-row-field">
              <span>Model</span>
              <select
                value={settings.ollamaModel}
                onChange={(event) => updateSettings({ ollamaModel: event.target.value })}
                aria-label="Ollama model"
              >
                <option value="">Select model</option>
                {settings.ollamaModel && !models.some((model) => model.model === settings.ollamaModel) && (
                  <option value={settings.ollamaModel}>{settings.ollamaModel} (not in latest list)</option>
                )}
                {models.map((model) => (
                  <option key={model.model} value={model.model}>
                    {modelLabel(model)}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-provider-actions">
              <button type="button" disabled={providerBusy !== null} onClick={() => void refreshModels()}>
                {providerBusy === 'refresh' ? 'Refreshing…' : 'Refresh Models'}
              </button>
              <button type="button" disabled={providerBusy !== null} onClick={() => void testConnection()}>
                {providerBusy === 'test' ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
            {providerStatus && (
              <p className="settings-provider-status" role="status">
                {providerStatus}
              </p>
            )}
          </div>
        )}

        <div className="settings-row">
          <span>Speed</span>
          <div className="settings-options">
            {TEXT_SPEEDS.map((speed) => (
              <button
                key={speed.label}
                type="button"
                aria-pressed={settings.textSpeed === speed.value}
                onClick={() => update({ textSpeed: speed.value })}
              >
                {speed.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.blipVolume}
            onChange={(event) => updateSettings({ blipVolume: Number(event.target.value) })}
            onPointerUp={testBlip}
          />
        </div>

        <div className="settings-row">
          <span>Mute blips</span>
          <input
            type="checkbox"
            checked={settings.blipsMuted}
            onChange={(event) => update({ blipsMuted: event.target.checked })}
          />
        </div>

        <div className="settings-row">
          <span>Display</span>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>
            Fullscreen
          </button>
        </div>

        <div className="settings-footer">
          <button type="button" onClick={testBlip}>
            Test blip
          </button>
          <button type="button" onClick={back}>
            Back
          </button>
        </div>
      </div>
    </PixelStage>
  )
}
