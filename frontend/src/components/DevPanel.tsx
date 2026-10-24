// TEMPORARY developer controls for visually verifying manifests and animations.
// Everything listed here is generated from the loaded manifests.
import { DevDisplayControls } from '../dev/DevDisplayControls.tsx'
import type { ResolvedClip } from '../engine/characterResolver.ts'
import type {
  Background,
  BackgroundId,
  EmotionId,
  LoadedCharacter,
  TalkMode,
} from '../engine/manifestTypes.ts'

interface DevPanelProps {
  character: LoadedCharacter
  emotion: EmotionId
  onEmotionChange: (emotion: EmotionId) => void
  mode: TalkMode
  onModeChange: (mode: TalkMode) => void
  backgrounds: Background[]
  backgroundId: BackgroundId | null
  onBackgroundChange: (id: BackgroundId) => void
  resolved: ResolvedClip | null
  frameIndex: number
  onExit: () => void
}

export function DevPanel({
  character,
  emotion,
  onEmotionChange,
  mode,
  onModeChange,
  backgrounds,
  backgroundId,
  onBackgroundChange,
  resolved,
  frameIndex,
  onExit,
}: DevPanelProps) {
  const clip = resolved?.clip
  const background = backgrounds.find((bg) => bg.id === backgroundId)

  return (
    <aside className="dev-panel">
      <h2>Asset / animation test (dev)</h2>
      <button type="button" onClick={onExit}>
        Back to menu
      </button>

      <section>
        <h3>{character.displayName} — emotion</h3>
        <div className="dev-buttons">
          {Object.entries(character.emotions).map(([id, binding]) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === emotion}
              onClick={() => onEmotionChange(id)}
              title={binding.reaction ? `reaction "${binding.reaction}" then "${binding.animation}"` : binding.animation}
            >
              {id}
              {binding.reaction ? ' ⚡' : ''}
            </button>
          ))}
        </div>
        <p className="dev-hint">⚡ plays a one-shot reaction first. Click again to replay it.</p>
      </section>

      <section>
        <h3>State</h3>
        <div className="dev-buttons">
          {(['idle', 'talking'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={m === mode} onClick={() => onModeChange(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Background</h3>
        <select
          value={backgroundId ?? ''}
          onChange={(event) => onBackgroundChange(event.target.value)}
        >
          {backgrounds.map((bg) => (
            <option key={bg.id} value={bg.id}>
              {bg.id} — {bg.description} ({bg.width}×{bg.height})
            </option>
          ))}
        </select>
        {background?.notes && <p className="dev-warning">{background.notes}</p>}
      </section>

      <section>
        <h3>Now playing</h3>
        {resolved && clip ? (
          <dl className="dev-readout">
            <dt>emotion</dt>
            <dd>{resolved.emotion}</dd>
            <dt>animation</dt>
            <dd>{resolved.animationId ?? '—'}</dd>
            <dt>variant</dt>
            <dd>
              {resolved.variant}
              {resolved.reactionId ? ` (${resolved.reactionId})` : ''}
            </dd>
            <dt>clip</dt>
            <dd>
              {clip.key} · {clip.fps} fps · {clip.loop ? 'loop' : 'one-shot'}
            </dd>
            <dt>frame</dt>
            <dd>
              {frameIndex + 1}/{clip.frames.length} · {clip.frames[frameIndex]?.path}
            </dd>
            {resolved.fallbacks.length > 0 && (
              <>
                <dt>fallback</dt>
                <dd className="dev-warning">{resolved.fallbacks.join('; ')}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="dev-warning">No playable animation resolved.</p>
        )}
        {clip && (
          <div className="dev-filmstrip">
            {clip.frames.map((frame, i) => (
              <img
                key={`${i}:${frame.url}`}
                src={frame.url}
                width={frame.width}
                height={frame.height}
                className={i === frameIndex ? 'current' : undefined}
                title={frame.path}
                alt=""
              />
            ))}
          </div>
        )}
      </section>

      <DevDisplayControls
        frame={clip?.frames[frameIndex] ?? null}
        clip={clip ?? null}
        background={background ?? null}
        render={character.render}
      />

      {character.warnings.length > 0 && (
        <section>
          <h3>Manifest warnings</h3>
          <ul className="dev-warning">
            {character.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
