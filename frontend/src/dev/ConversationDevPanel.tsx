// TEMPORARY developer controls for the conversation scene (dev builds only).
import { audioEngine } from '../engine/audioEngine.ts'
import type { DialogueLine } from '../engine/dialogueTypes.ts'
import type { Background, CharacterRender, SoundId } from '../engine/manifestTypes.ts'
import type { ChatResponse } from '../engine/performance.ts'
import type { CharacterAnimationState } from '../engine/useCharacterAnimation.ts'
import type { TypewriterState } from '../engine/useTypewriter.ts'
import { DevDisplayControls } from './DevDisplayControls.tsx'

interface ConversationDevPanelProps {
  lineNumber: number
  lineCount: number
  line: DialogueLine
  phase: string
  typewriterState: TypewriterState
  animation: CharacterAnimationState
  background: Background | null
  render: CharacterRender
  voice: SoundId | null
  voiceOverride: SoundId | null
  onVoiceOverrideChange: (voice: SoundId | null) => void
  /** Last backend reply, for inspecting the director's decisions. */
  lastResponse: ChatResponse | null
  onPlayTestScript: () => void
  /** Restart the current line, optionally forcing a voice (null = script/character). */
  onReplayLine: (voice: SoundId | null) => void
  onExit: () => void
}

export function ConversationDevPanel({
  lineNumber,
  lineCount,
  line,
  phase,
  typewriterState,
  animation,
  background,
  render,
  voice,
  voiceOverride,
  onVoiceOverrideChange,
  lastResponse,
  onPlayTestScript,
  onReplayLine,
  onExit,
}: ConversationDevPanelProps) {
  const blips = audioEngine.getSounds('blip')
  // Dev convenience: the audio manifest's male blip, if present.
  const maleBlip = blips.find((sound) => sound.id.includes('male') && !sound.id.includes('female'))?.id ?? null
  const { resolved } = animation

  return (
    <aside className="dev-panel">
      <h2>Dialogue dev panel (temporary)</h2>

      <section>
        <h3>Voice / blip</h3>
        <div className="dev-buttons">
          <button type="button" aria-pressed={voiceOverride === null} onClick={() => onVoiceOverrideChange(null)}>
            script / character
          </button>
          {blips.map((sound) => (
            <button
              key={sound.id}
              type="button"
              aria-pressed={voiceOverride === sound.id}
              onClick={() => onVoiceOverrideChange(sound.id)}
            >
              {sound.id}
            </button>
          ))}
        </div>
        <p className="dev-hint">Playing: {voice ?? 'none'}</p>
      </section>

      <section>
        <h3>Now playing</h3>
        <dl className="dev-readout">
          <dt>phase</dt>
          <dd>{phase}</dd>
          <dt>line</dt>
          <dd>
            {lineNumber}/{lineCount}
          </dd>
          <dt>emotion</dt>
          <dd>{line.emotion}</dd>
          <dt>text</dt>
          <dd>{typewriterState}</dd>
          <dt>animation</dt>
          <dd>{resolved ? `${resolved.clip.key} (${resolved.variant})` : '—'}</dd>
          <dt>frame</dt>
          <dd>{animation.frame?.path ?? '—'}</dd>
          {resolved && resolved.fallbacks.length > 0 && (
            <>
              <dt>fallback</dt>
              <dd className="dev-warning">{resolved.fallbacks.join('; ')}</dd>
            </>
          )}
        </dl>
      </section>

      <section>
        <h3>Last AI reply</h3>
        {lastResponse ? (
          <>
            <p className="dev-hint">
              provider: {lastResponse.provider.type}
              {lastResponse.provider.model ? ` (${lastResponse.provider.model})` : ''} · settle:{' '}
              {lastResponse.performance.settle.emotion} / {lastResponse.performance.settle.animation}
            </p>
            <ol className="dev-readout dev-segments">
              {lastResponse.performance.segments.map((s, i) => (
                <li key={i}>
                  {s.emotion} → {s.animation} · {s.intensity.toFixed(2)}
                  {s.reaction ? ` · ⚡${s.reaction}` : ''}
                  {s.gesture ? ` · ✋${s.gesture}` : ''}
                </li>
              ))}
            </ol>
            {[...lastResponse.performance.notes, ...lastResponse.warnings].map((note) => (
              <p key={note} className="dev-warning">
                {note}
              </p>
            ))}
          </>
        ) : (
          <p className="dev-hint">No reply yet. Type a message under the scene.</p>
        )}
      </section>

      <DevDisplayControls
        frame={animation.frame}
        clip={resolved?.clip ?? null}
        background={background}
        render={render}
      />

      <section>
        <h3>Controls</h3>
        <div className="dev-buttons">
          <button type="button" onClick={() => onReplayLine(voiceOverride)}>
            Replay line
          </button>
          <button type="button" onClick={() => onReplayLine(maleBlip)}>
            Replay line with male blip
          </button>
          <button type="button" onClick={onPlayTestScript}>
            Play test script
          </button>
          <button type="button" onClick={onExit}>
            Back to menu
          </button>
        </div>
        <p className="dev-hint">
          Click scene / Enter / Space: skip text, then advance. Esc: menu. FakeProvider triggers: #messy, #error,
          #malformed, #empty, #text, #timeout.
        </p>
      </section>
    </aside>
  )
}
