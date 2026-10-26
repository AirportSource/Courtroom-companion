import { useEffect, useRef, type ReactNode } from 'react'
import { EvidenceTile } from '../courtRecord/EvidenceTile.tsx'
import type { UiImage } from '../engine/manifestTypes.ts'
import type { ArtifactDeliveryState } from './artifactDelivery.ts'
import { useT } from '../i18n/useT.ts'
import './ArtifactDeliveryOverlay.css'

export interface ArtifactDeliveryOverlayProps {
  state: ArtifactDeliveryState
  phoneIcon?: ReactNode
  evidenceIcon?: ReactNode
  /** Native 70×70 evidence frame (ui.images.evidence_frame) for the phone and summon. */
  evidenceFrame?: UiImage | null
  /** Parent enables advance after ARTIFACT_SUMMON_MIN_MS and owns the fallback timer. */
  canAdvance?: boolean
  onPhoneAcknowledge: () => void
  onSummonAdvance: () => void
}

/** UI in the existing 256x192 stage; assets, character performance and audio belong to the caller. */
export function ArtifactDeliveryOverlay({ state, phoneIcon, evidenceIcon, evidenceFrame = null, canAdvance = false,
  onPhoneAcknowledge, onSummonAdvance }: ArtifactDeliveryOverlayProps) {
  const t = useT()
  const lastAction = useRef<string | null>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const phase = state.phase
  useEffect(() => {
    if (phase === 'waiting-for-phone-acknowledgement' || (phase === 'evidence-summon' && canAdvance)) {
      actionRef.current?.focus({ preventScroll: true })
    }
  }, [phase, canAdvance, state.turnId])
  if (phase !== 'artifact-working' && phase !== 'artifact-done' && phase !== 'waiting-for-phone-acknowledgement' && phase !== 'evidence-summon') return null

  const phone = phase === 'waiting-for-phone-acknowledgement'
  const summon = phase === 'evidence-summon'
  const act = () => {
    if ((!phone && !(summon && canAdvance)) || !state.turnId) return
    const key = `${state.turnId}:${phase}`
    if (lastAction.current === key) return
    lastAction.current = key
    if (phone) onPhoneAcknowledge()
    else onSummonAdvance()
  }

  return (
    <div className={`artifact-delivery artifact-delivery--${phase}`} data-artifact-delivery={phase}
      onClick={(event) => event.stopPropagation()}>
      {summon ? (
        <div className="artifact-delivery__summon" role="status" aria-live="polite" aria-label="Evidence received">
          {evidenceFrame
            ? <div className="artifact-delivery__evidence artifact-delivery__evidence--framed" aria-hidden="true">
              <EvidenceTile frame={evidenceFrame}>{evidenceIcon}</EvidenceTile>
            </div>
            : <div className="artifact-delivery__evidence" aria-hidden="true">{evidenceIcon}</div>}
          <div className="artifact-delivery__record">
            <div className="artifact-delivery__filename">{state.artifact?.displayName}</div>
            <div>{t('artifact.added')}</div>
          </div>
        </div>
      ) : (
        // The working/done cue is the stage-corner magnifier (D-079); only the phone is a prop here.
        phone && <div className="artifact-delivery__prop" aria-hidden="true">
          <EvidenceTile frame={evidenceFrame}>{phoneIcon}</EvidenceTile>
        </div>
      )}
      {!summon && <div className="artifact-delivery__message" role="status" aria-live="polite">
        {t(phone || phase === 'artifact-done' ? 'artifact.ready' : 'artifact.creating')}
      </div>}
      {(phone || summon) && (
        <button ref={actionRef} className="artifact-delivery__action" type="button" autoFocus disabled={summon && !canAdvance}
          onClick={act} onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              if (!event.repeat) act()
            }
          }}>
          {t(phone ? 'artifact.answerPhone' : 'common.continue')}
        </button>
      )}
    </div>
  )
}
