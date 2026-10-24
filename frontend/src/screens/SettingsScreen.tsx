import { useEffect, useRef, useState } from 'react'
import { PixelStage } from '../components/PixelStage.tsx'
import { ProviderProfilesPanel } from '../components/ProviderProfilesPanel.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import { getRingtoneCatalog, previewRingtone, resolveRingtone } from '../engine/ringtones.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import type { SoundId, UiImage } from '../engine/manifestTypes.ts'
import { bgmPool, contextualPool, resolveProfileTrack, type SoundtrackManifest } from '../music/soundtrack.ts'
import type { MusicSourceSetting } from '../music/types.ts'
import { TEXT_SPEEDS, useSettings } from '../settings/settings.ts'

const MUSIC_SOURCES: { value: MusicSourceSetting; label: string }[] = [
  { value: 'original', label: 'Game music' },
  { value: 'imported', label: 'Imported' },
  { value: 'radio', label: 'Radio' },
  { value: 'off', label: 'Off' },
]

interface SettingsScreenProps {
  previewBlip: SoundId | null
  testCharacterId: string | null
  soundtrack: SoundtrackManifest | null
  /** Imported library entries for the track picker (empty until the library loads). */
  importedTracks?: { id: string; title: string }[]
  onBack: () => void
  backdrop: UiImage | null
}

export function SettingsScreen({
  previewBlip, testCharacterId, soundtrack, importedTracks = [], onBack, backdrop,
}: SettingsScreenProps) {
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

  const ringtones = getRingtoneCatalog()
  const [previewing, setPreviewing] = useState(false)
  const stopPreview = useRef<(() => void) | null>(null)
  const endPreview = () => stopPreview.current?.()
  useEffect(() => () => stopPreview.current?.(), [])
  const sfxSilent = settings.sfxMuted || settings.sfxVolume <= 0
  const startPreview = (ringtoneId: string) => {
    endPreview()
    if (sfxSilent) return
    audioEngine.unlock()
    setPreviewing(true)
    const stop = previewRingtone(audioEngine, ringtoneId, settings.sfxVolume, () => {
      if (stopPreview.current === stop) stopPreview.current = null
      setPreviewing(false)
    })
    stopPreview.current = stop
  }

  const testBlip = () => {
    audioEngine.unlock()
    if (previewBlip && !settings.blipsMuted) audioEngine.play(previewBlip, settings.blipVolume)
  }

  return (
    <PixelStage>
      <StageBackdrop image={backdrop} />
      <div className={`menu-screen settings-screen ${backdrop ? 'menu-screen-overlay' : 'menu-screen-plain'}`}>
        <h1 className="menu-heading">Settings</h1>
        <ProviderProfilesPanel characterId={testCharacterId} />

        <div className="settings-row">
          <span>Speed</span>
          <div className="settings-options">
            {TEXT_SPEEDS.map((speed) => (
              <button key={speed.label} type="button" aria-pressed={settings.textSpeed === speed.value}
                onClick={() => update({ textSpeed: speed.value })}>{speed.label}</button>
            ))}
          </div>
        </div>

        <div className="settings-row settings-row-field">
          <span>Music</span>
          <select aria-label="Music source" value={settings.musicSource}
            onChange={(event) => update({ musicSource: event.target.value as MusicSourceSetting })}>
            {MUSIC_SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        {settings.musicSource === 'original' && soundtrack && (
          <div className="settings-row settings-row-field">
            <span>Track</span>
            <select aria-label="Soundtrack track" value={settings.originalTrackId || ''}
              onChange={(event) => update({ originalTrackId: event.target.value })}>
              <option value="">Default ({soundtrack.tracks[resolveProfileTrack(soundtrack) ?? '']?.title ?? 'none'})</option>
              <optgroup label="Background music">
                {bgmPool(soundtrack).map((id) => <option key={id} value={id}>{soundtrack.tracks[id].title}</option>)}
              </optgroup>
              <optgroup label="Event music">
                {contextualPool(soundtrack).map((id) => <option key={id} value={id}>{soundtrack.tracks[id].title}</option>)}
              </optgroup>
            </select>
          </div>
        )}

        {settings.musicSource === 'imported' && (
          <div className="settings-row settings-row-field">
            <span>Track</span>
            <select aria-label="Imported track" value={settings.importedTrackId}
              onChange={(event) => update({ importedTrackId: event.target.value })}>
              <option value="">{importedTracks.length ? 'Choose…' : 'Import below'}</option>
              {importedTracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}
            </select>
          </div>
        )}

        <div className="settings-row">
          <span>BGM vol</span>
          <input aria-label="Music volume" type="range" min={0} max={1} step={0.05} value={settings.musicVolume}
            onChange={(event) => updateSettings({ musicVolume: Number(event.target.value) })} />
        </div>

        <div className="settings-row">
          <span>Mute BGM</span>
          <input aria-label="Mute music" type="checkbox" checked={settings.musicMuted}
            onChange={(event) => update({ musicMuted: event.target.checked })} />
        </div>

        <div className="settings-row">
          <span>Blip vol</span>
          <input aria-label="Blip volume" type="range" min={0} max={1} step={0.05} value={settings.blipVolume}
            onChange={(event) => updateSettings({ blipVolume: Number(event.target.value) })} onPointerUp={testBlip} />
        </div>

        <div className="settings-row">
          <span>Mute blips</span>
          <input aria-label="Mute blips" type="checkbox" checked={settings.blipsMuted}
            onChange={(event) => update({ blipsMuted: event.target.checked })} />
        </div>

        <div className="settings-row">
          <span>SFX vol</span>
          <input aria-label="Sound effects volume" type="range" min={0} max={1} step={0.05} value={settings.sfxVolume}
            onChange={(event) => updateSettings({ sfxVolume: Number(event.target.value) })} />
        </div>

        {ringtones && (
          <div className="settings-row settings-row-field">
            <span>Ringtone</span>
            <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
              <select aria-label="Phone ringtone" value={resolveRingtone(ringtones, settings.ringtoneId).id}
                onChange={(event) => { endPreview(); update({ ringtoneId: event.target.value }) }}>
                {ringtones.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <button type="button" disabled={sfxSilent || previewing}
                onClick={() => startPreview(settings.ringtoneId)}>Preview</button>
              <button type="button" disabled={!previewing} onClick={endPreview}>Stop</button>
            </div>
          </div>
        )}

        <div className="settings-row">
          <span>Mute SFX</span>
          <input aria-label="Mute sound effects" type="checkbox" checked={settings.sfxMuted}
            onChange={(event) => update({ sfxMuted: event.target.checked })} />
        </div>

        <div className="settings-row">
          <span>Display</span>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>Fullscreen</button>
        </div>

        <div className="settings-footer">
          <button type="button" onClick={testBlip}>Test blip</button>
          <button type="button" onClick={back}>Back</button>
        </div>
      </div>
    </PixelStage>
  )
}
