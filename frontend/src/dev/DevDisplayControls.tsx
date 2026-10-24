// TEMPORARY: stage scale, character render overrides, alignment A/B, debug overlay,
// menu-sound test buttons and a native/rendered size readout.
import { audioEngine } from '../engine/audioEngine.ts'
import type { AnimationClip, Background, CharacterRender, SpriteFrame } from '../engine/manifestTypes.ts'
import { MENU_SOUNDS, playMenuSound } from '../engine/menuSounds.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../engine/stage.ts'
import { CHARACTER_SCALES, NO_CHARACTER_OVERRIDE, STAGE_SCALE_MODES, useDevDisplay } from './devDisplay.ts'

interface DevDisplayControlsProps {
  frame: SpriteFrame | null
  clip: AnimationClip | null
  background: Background | null
  /** The character's manifest render profile (overrides are applied on top). */
  render: CharacterRender
}

export function DevDisplayControls({ frame, clip, background, render }: DevDisplayControlsProps) {
  const { display, update } = useDevDisplay()
  const override = display.character
  const stage = document.querySelector<HTMLElement>('.scene-stage')
  const stageScale = Number(stage?.dataset.scale ?? 1)
  const scale = override.scale ?? render.scale
  const offsetX = override.offsetX ?? render.offsetX
  const offsetY = override.offsetY ?? render.offsetY
  const setOverride = (patch: Partial<typeof override>) => update({ character: { ...override, ...patch } })

  return (
    <section>
      <h3>Display</h3>
      <div className="dev-buttons">
        <span className="dev-label">stage</span>
        {STAGE_SCALE_MODES.map((mode) => (
          <button key={mode} type="button" aria-pressed={display.scale === mode} onClick={() => update({ scale: mode })}>
            {mode === 'auto' ? 'auto' : `${mode}×`}
          </button>
        ))}
      </div>
      <div className="dev-buttons">
        <span className="dev-label">character</span>
        <button type="button" aria-pressed={override.scale === null} onClick={() => setOverride({ scale: null })}>
          manifest ({render.scale})
        </button>
        {CHARACTER_SCALES.map((s) => (
          <button key={s} type="button" aria-pressed={override.scale === s} onClick={() => setOverride({ scale: s })}>
            {s.toFixed(2)}
          </button>
        ))}
      </div>
      <div className="dev-buttons">
        <span className="dev-label">offset</span>
        <button type="button" onClick={() => setOverride({ offsetX: offsetX - 1 })}>x−</button>
        <button type="button" onClick={() => setOverride({ offsetX: offsetX + 1 })}>x+</button>
        <button type="button" onClick={() => setOverride({ offsetY: offsetY - 1 })}>y−</button>
        <button type="button" onClick={() => setOverride({ offsetY: offsetY + 1 })}>y+</button>
        <button type="button" onClick={() => update({ character: NO_CHARACTER_OVERRIDE })}>reset to manifest</button>
      </div>
      <div className="dev-buttons">
        <button type="button" aria-pressed={display.alignment === 'canvas'} onClick={() => update({ alignment: 'canvas' })}>
          canvas anchor
        </button>
        <button
          type="button"
          aria-pressed={display.alignment === 'per-frame'}
          onClick={() => update({ alignment: 'per-frame' })}
        >
          per-frame centring (old)
        </button>
        <button type="button" aria-pressed={display.debugOverlay} onClick={() => update({ debugOverlay: !display.debugOverlay })}>
          debug overlay
        </button>
      </div>
      <dl className="dev-readout">
        <dt>stage</dt>
        <dd>
          {STAGE_WIDTH}×{STAGE_HEIGHT} @ {stageScale}× → {STAGE_WIDTH * stageScale}×{STAGE_HEIGHT * stageScale} css px
        </dd>
        <dt>background</dt>
        <dd>{background ? `${background.width}×${background.height} native` : '—'}</dd>
        <dt>frame</dt>
        <dd>
          {frame
            ? `${frame.width}×${frame.height} native → ${Math.round(frame.width * scale)}×${Math.round(frame.height * scale)} stage px → ${Math.round(frame.width * scale) * stageScale}×${Math.round(frame.height * scale) * stageScale} css px`
            : '—'}
        </dd>
        <dt>canvas</dt>
        <dd>{clip ? `${clip.canvas.width}×${clip.canvas.height}${clip.aligned ? '' : ' (derived, no offsets)'}` : '—'}</dd>
        <dt>render</dt>
        <dd className={Number.isInteger(scale) ? undefined : 'dev-warning'}>
          scale {scale} · offset ({offsetX}, {offsetY})
          {Number.isInteger(scale) ? '' : ' · non-integer scale distorts pixels'}
          {override.scale !== null || override.offsetX !== null || override.offsetY !== null ? ' · OVERRIDDEN' : ''}
        </dd>
      </dl>
      <p className="dev-hint">
        Overlay: cyan = canvas, magenta = frame, yellow = anchor, green = baseline. Overrides are temporary; copy chosen
        values into the character manifest&apos;s "render".
      </p>
      <h3>Menu sounds</h3>
      <div className="dev-buttons">
        {MENU_SOUNDS.map((sound) => (
          <button
            key={sound}
            type="button"
            title={audioEngine.getEvents().find(([e]) => e === sound)?.[1] ?? 'unmapped'}
            onClick={() => {
              audioEngine.unlock()
              playMenuSound(sound)
            }}
          >
            {sound.replace('menu_', '')}
          </button>
        ))}
      </div>
    </section>
  )
}
