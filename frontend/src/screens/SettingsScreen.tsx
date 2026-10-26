import { useEffect, useRef, useState } from 'react'
import { PixelStage } from '../components/PixelStage.tsx'
import { ProviderProfilesPanel } from '../components/ProviderProfilesPanel.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { StageSelect } from '../components/StageSelect.tsx'
import { ToolsPanel } from '../tools/ToolsPanel.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import { getRingtoneCatalog, previewRingtone, resolveRingtone } from '../engine/ringtones.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import type { SoundId, UiImage } from '../engine/manifestTypes.ts'
import { bgmPool, contextualPool, resolveProfileTrack, trackListLabel, type SoundtrackManifest } from '../music/soundtrack.ts'
import type { MusicSourceSetting } from '../music/types.ts'
import { TEXT_SPEEDS, useSettings, type StageScaling } from '../settings/settings.ts'
import { LANGUAGES, type Language, type StringKey } from '../i18n/i18n.ts'
import { useT } from '../i18n/useT.ts'

const MUSIC_SOURCES: { value: MusicSourceSetting; label: StringKey }[] = [
  { value: 'original', label: 'music.game' },
  { value: 'imported', label: 'music.imported' },
  { value: 'radio', label: 'music.radio' },
  { value: 'off', label: 'music.off' },
]

const STAGE_SCALINGS: { value: StageScaling; label: StringKey; title: StringKey }[] = [
  { value: 'pixel', label: 'settings.scalePixel', title: 'settings.scalePixelTitle' },
  { value: 'fit', label: 'settings.scaleFit', title: 'settings.scaleFitTitle' },
]

const SPEED_LABELS: Record<number, StringKey> = { 0.5: 'settings.slow', 1: 'settings.normal', 2: 'settings.fast' }

interface SettingsScreenProps {
  previewBlip: SoundId | null
  testCharacterId: string | null
  soundtrack: SoundtrackManifest | null
  /** Imported library entries for the track picker (empty until the library loads). */
  importedTracks?: { id: string; title: string }[]
  onBack: () => void
  /** Opens the Character Studio (Character Lore Builder, D-103). */
  onCharacterStudio?: () => void
  backdrop: UiImage | null
}

export function SettingsScreen({
  previewBlip, testCharacterId, soundtrack, importedTracks = [], onBack, onCharacterStudio, backdrop,
}: SettingsScreenProps) {
  const { settings, update: updateSettings } = useSettings()
  const t = useT()
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
        <h1 className="menu-heading">{t('settings.heading')}</h1>

        <div className="settings-row settings-row-field">
          <span>{t('settings.language')}</span>
          <StageSelect label={t('settings.language')} value={settings.language} options={LANGUAGES}
            onChange={(value) => updateSettings({ language: value as Language })} />
        </div>

        <div className="settings-row">
          <span>{t('settings.shouts')}</span>
          <div className="settings-options">
            {(['ja', 'en'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={settings.shoutLanguage === value}
                onClick={() => update({ shoutLanguage: value })}>{value === 'ja' ? '日本語' : 'English'}</button>
            ))}
          </div>
        </div>

        <div className="settings-row settings-row-field">
          <span>{t('reading.setting')}</span>
          <button type="button" role="switch" aria-label={t('reading.setting')}
            aria-checked={settings.japaneseReadingAssistant}
            onClick={() => update({ japaneseReadingAssistant: !settings.japaneseReadingAssistant })}>
            {t(settings.japaneseReadingAssistant ? 'reading.on' : 'reading.off')}
          </button>
        </div>

        {settings.japaneseReadingAssistant && <div className="settings-row settings-row-field">
          <span>{t('reading.definitions')}</span>
          <StageSelect label={t('reading.definitions')} value={settings.japaneseDefinitionLanguage}
            options={[{value:'fr', label:'Français'}, {value:'en', label:'English'}]}
            onChange={value => update({japaneseDefinitionLanguage: value === 'en' ? 'en' : 'fr'})} />
        </div>}
        <div className="settings-row settings-row-field">
          <a href={`${import.meta.env.BASE_URL}assets/jmdict/NOTICE.html`} target="_blank" rel="noreferrer">JMdict · EDRDG · CC BY-SA</a>
        </div>

        <ProviderProfilesPanel characterId={testCharacterId} />
        <ToolsPanel />

        {onCharacterStudio && (
          <div className="settings-row settings-row-field">
            <span>{t('settings.characterStudio')}</span>
            <button type="button" onClick={() => { playMenuSound('menu_confirm'); onCharacterStudio() }}>
              {t('settings.characterStudioOpen')}
            </button>
          </div>
        )}

        <div className="settings-row">
          <span>{t('settings.speed')}</span>
          <div className="settings-options">
            {TEXT_SPEEDS.map((speed) => (
              <button key={speed.label} type="button" aria-pressed={settings.textSpeed === speed.value}
                onClick={() => update({ textSpeed: speed.value })}>{t(SPEED_LABELS[speed.value] ?? 'settings.normal')}</button>
            ))}
          </div>
        </div>

        <div className="settings-row settings-row-field">
          <span>{t('settings.music')}</span>
          <StageSelect label={t('settings.music')} value={settings.musicSource}
            options={MUSIC_SOURCES.map((option) => ({ value: option.value, label: t(option.label) }))}
            onChange={(value) => updateSettings({ musicSource: value as MusicSourceSetting })} />
        </div>

        {settings.musicSource === 'original' && soundtrack && (
          <div className="settings-row settings-row-field">
            <span>{t('settings.track')}</span>
            <StageSelect label="Soundtrack track" value={settings.originalTrackId || ''}
              onChange={(value) => updateSettings({ originalTrackId: value })}
              options={[
                { value: '', label: t('settings.trackDefault', { title: (() => { const entry = soundtrack.tracks[resolveProfileTrack(soundtrack) ?? '']; return entry ? trackListLabel(entry) : '—' })() }) },
                ...[...bgmPool(soundtrack), ...contextualPool(soundtrack)].map((id) => ({ value: id, label: trackListLabel(soundtrack.tracks[id]) })),
              ]} />
          </div>
        )}

        {settings.musicSource === 'imported' && (
          <div className="settings-row settings-row-field">
            <span>{t('settings.track')}</span>
            <StageSelect label="Imported track" value={settings.importedTrackId}
              onChange={(value) => updateSettings({ importedTrackId: value })}
              options={[
                { value: '', label: t(importedTracks.length ? 'settings.importedChoose' : 'settings.importBelow') },
                ...importedTracks.map((track) => ({ value: track.id, label: track.title })),
              ]} />
          </div>
        )}

        <div className="settings-row">
          <span>{t('settings.bgmVolume')}</span>
          <input aria-label="Music volume" type="range" min={0} max={1} step={0.05} value={settings.musicVolume}
            onChange={(event) => updateSettings({ musicVolume: Number(event.target.value) })} />
        </div>

        <div className="settings-row">
          <span>{t('settings.muteBgm')}</span>
          <input aria-label="Mute music" type="checkbox" checked={settings.musicMuted}
            onChange={(event) => update({ musicMuted: event.target.checked })} />
        </div>

        <div className="settings-row">
          <span>{t('settings.blipVolume')}</span>
          <input aria-label="Blip volume" type="range" min={0} max={1} step={0.05} value={settings.blipVolume}
            onChange={(event) => updateSettings({ blipVolume: Number(event.target.value) })} onPointerUp={testBlip} />
        </div>

        <div className="settings-row">
          <span>{t('settings.muteBlips')}</span>
          <input aria-label="Mute blips" type="checkbox" checked={settings.blipsMuted}
            onChange={(event) => update({ blipsMuted: event.target.checked })} />
        </div>

        <div className="settings-row">
          <span>{t('settings.sfxVolume')}</span>
          <input aria-label="Sound effects volume" type="range" min={0} max={1} step={0.05} value={settings.sfxVolume}
            onChange={(event) => updateSettings({ sfxVolume: Number(event.target.value) })} />
        </div>

        {ringtones && (
          <div className="settings-row settings-row-field">
            <span>{t('settings.ringtone')}</span>
            <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
              <StageSelect label="Phone ringtone" value={resolveRingtone(ringtones, settings.ringtoneId).id}
                onChange={(value) => { endPreview(); updateSettings({ ringtoneId: value }) }}
                options={ringtones.items.map((item) => ({ value: item.id, label: item.label }))} />
              <button type="button" disabled={sfxSilent || previewing}
                onClick={() => startPreview(settings.ringtoneId)}>{t('settings.preview')}</button>
              <button type="button" disabled={!previewing} onClick={endPreview}>{t('settings.stop')}</button>
            </div>
          </div>
        )}

        <div className="settings-row">
          <span>{t('settings.muteSfx')}</span>
          <input aria-label="Mute sound effects" type="checkbox" checked={settings.sfxMuted}
            onChange={(event) => update({ sfxMuted: event.target.checked })} />
        </div>

        <div className="settings-row">
          <span>{t('settings.scale')}</span>
          <div className="settings-options">
            {STAGE_SCALINGS.map((option) => (
              <button key={option.value} type="button" aria-pressed={settings.stageScaling === option.value}
                title={t(option.title)} onClick={() => update({ stageScaling: option.value })}>{t(option.label)}</button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span>{t('settings.display')}</span>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>{t('settings.fullscreen')}</button>
        </div>

        <div className="settings-footer">
          <button type="button" onClick={testBlip}>{t('settings.testBlip')}</button>
          <button type="button" onClick={back}>{t('common.back')}</button>
        </div>
      </div>
    </PixelStage>
  )
}
