import type { ReactNode } from 'react'
import { setPanelExpanded } from './collapsiblePanel.ts'
import { CollapsiblePanel } from './CollapsiblePanel.tsx'
import { audioEngine } from '../engine/audioEngine.ts'
import { musicRuntime } from '../music/musicRuntime.ts'
import { RadioPanel } from '../music/radio/RadioPanel.tsx'
import { DEFAULT_RADIO_VIDEO_ID } from '../music/radio/presets.ts'
import type { SoundtrackManifest } from '../music/soundtrack.ts'
import type { MusicEngineState } from '../music/types.ts'
import { useMusicState } from '../music/useMusicSync.ts'
import { useSettings } from '../settings/settings.ts'

const SOURCE_LABELS = { original: 'Game music', imported: 'Imported', radio: 'Radio' } as const

function statusLine(state: MusicEngineState, soundtrack: SoundtrackManifest | null, trackId: string | null): string {
  const title = state.title ?? (trackId && soundtrack?.tracks[trackId]?.title) ?? trackId ?? ''
  switch (state.status) {
    case 'idle':
      return state.source ? 'Nothing selected' : 'Music off'
    case 'loading':
      return `Loading ${title}…`
    case 'playing':
      return title
    case 'paused':
      return `Paused: ${title}`
    case 'blocked':
      return 'Autoplay blocked: press Play'
    case 'error':
      return state.error?.message ?? 'Music unavailable'
  }
}

interface MusicDockProps {
  soundtrack: SoundtrackManifest | null
  /** Out-of-stage panel for the imported library (supplied by App when available). */
  importPanel?: ReactNode
  /** A Play pressed on a menu screen asks the host to let music sound there (menus are silent by default). */
  onAudition?: () => void
}

/**
 * Music controls outside the 256×192 stage (like the chat bar, D-035). The official YouTube
 * player is always mounted here, so it persists across screens and is never covered; it is
 * shown whenever Radio is the selected source.
 */
export function MusicDock({ soundtrack, importPanel, onAudition }: MusicDockProps) {
  const { settings, update } = useSettings()
  const state = useMusicState()
  const { engine, radio } = musicRuntime()
  const source = settings.musicSource
  // The official player must be visible while radio plays: the Radio section is locked open then,
  // and pressing Play re-opens it.
  const radioActive = state.source === 'radio' && (state.status === 'playing' || state.status === 'loading')

  // Every Play here is a real user gesture: unlock Web Audio first, then recover.
  const play = () => {
    audioEngine.unlock()
    if (source === 'radio') update({ expandedPanels: setPanelExpanded(settings.expandedPanels, 'music-radio', true) })
    onAudition?.()
    if (state.status === 'paused') engine.resume()
    else if (state.status === 'blocked' && state.source === 'radio') radio.resume()
    else void engine.retry()
  }
  // 'idle' with a source selected = silent menu: Play auditions it (via onAudition).
  const canPlay = state.status === 'paused' || state.status === 'blocked' || state.status === 'error'
    || (state.status === 'idle' && source !== 'off' && Boolean(onAudition))

  return (
    <aside className="music-dock" aria-label="Music">
      <div className="music-dock-bar">
        <span className="music-dock-source">♪ {source === 'off' ? 'Off' : SOURCE_LABELS[source]}</span>
        <span className="music-dock-status" role="status">{statusLine(state, soundtrack, state.trackId)}</span>
        {canPlay && source !== 'off' && <button type="button" onClick={play}>Play</button>}
        {state.status === 'playing' && <button type="button" onClick={() => engine.pause()}>Pause</button>}
      </div>
      {/* Always mounted (the engine stops it when Radio is not the active source). */}
      <div className="music-dock-panel" hidden={source !== 'radio'}>
        <CollapsiblePanel id="music-radio" title="Music / Radio" keepMounted locked={radioActive}>
        <RadioPanel
          source={radio}
          videoId={settings.radioVideoId || DEFAULT_RADIO_VIDEO_ID}
          onVideoIdChange={(id) => update({ radioVideoId: id === DEFAULT_RADIO_VIDEO_ID ? '' : id })}
          onPlay={play}
          visible={source === 'radio'}
        />
        </CollapsiblePanel>
      </div>
      {source === 'imported' && importPanel && (
        <div className="music-dock-panel">
          <CollapsiblePanel id="music-library" title="Imported library / loop editor">{importPanel}</CollapsiblePanel>
        </div>
      )}
    </aside>
  )
}
