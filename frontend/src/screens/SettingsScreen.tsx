import { useEffect } from 'react'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import type { SoundId, UiImage } from '../engine/manifestTypes.ts'
import { TEXT_SPEEDS, useSettings } from '../settings/settings.ts'

interface SettingsScreenProps {
  /** Blip used for the "test" button (first blip sound in audio.json). */
  previewBlip: SoundId | null
  onBack: () => void
  /** Original DS panel behind the settings (ui.json); CSS gradient fallback when absent. */
  backdrop: UiImage | null
}

export function SettingsScreen({ previewBlip, onBack, backdrop }: SettingsScreenProps) {
  const { settings, update: updateSettings } = useSettings()
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

  return (
    <PixelStage>
      <StageBackdrop image={backdrop} />
      <div className={`menu-screen settings-screen ${backdrop ? 'menu-screen-overlay' : 'menu-screen-plain'}`}>
        <h1 className="menu-heading">Settings</h1>

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
