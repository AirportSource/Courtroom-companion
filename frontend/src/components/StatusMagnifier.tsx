import type { UiImage } from '../engine/manifestTypes.ts'
import type { StatusMagnifierMode } from './statusMagnifier.ts'
import './StatusMagnifier.css'

interface StatusMagnifierProps {
  mode: StatusMagnifierMode
  working: UiImage | null
  done: UiImage | null
  label: string
}

/**
 * Native 28x28 DS-scale magnifier in the stage's top-right corner (logical 256x192 pixels, never
 * smoothed). Purely presentational: ConversationScreen decides the mode through statusMagnifierMode.
 */
export function StatusMagnifier({ mode, working, done, label }: StatusMagnifierProps) {
  const image = mode === 'working' ? working : mode === 'done' ? done : null
  if (!image) return null
  return (
    <div className={`status-magnifier status-magnifier--${mode}`} data-status-magnifier={mode} role="status" aria-label={label}>
      <img src={image.url} width={image.width} height={image.height} alt="" draggable={false} />
    </div>
  )
}
