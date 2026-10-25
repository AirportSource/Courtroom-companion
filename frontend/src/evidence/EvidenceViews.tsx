import type { UiImage } from '../engine/manifestTypes.ts'
import { evidenceBadge, formatSize, type EvidenceDraft } from './evidence.ts'
import { OverflowMarquee } from '../components/OverflowMarquee.tsx'
import { useT } from '../i18n/useT.ts'
import './evidence.css'

/** Window content: the photo filling 64×64, or the file icon with a type badge. */
function EvidenceFace({ evidence, fileIcon }: { evidence: EvidenceDraft; fileIcon: UiImage | null }) {
  if (evidence.previewUrl) return <img className="evidence-photo" src={evidence.previewUrl} alt="" draggable={false} />
  return (
    <span className="evidence-file">
      {fileIcon && <img src={fileIcon.url} width={fileIcon.width} height={fileIcon.height} alt="" draggable={false} />}
      <span className="evidence-badge">{evidenceBadge(evidence.kind, evidence.name)}</span>
    </span>
  )
}

interface PresentedEvidenceProps {
  evidence: EvidenceDraft
  fileIcon: UiImage | null
}

/**
 * In-stage card shown while the character examines what the user presented (DS "present" box):
 * the dialogue box's double border around a 64×64 window, the photo cropped to fill it (no
 * letterbox bars), and the name in a nameplate strip along the bottom.
 */
export function PresentedEvidence({ evidence, fileIcon }: PresentedEvidenceProps) {
  const t = useT()
  return (
    <div className="presented-evidence" role="status" aria-label={t('evidence.presented', { name: evidence.name })}>
      <span className="presented-evidence-window" aria-hidden="true"><EvidenceFace evidence={evidence} fileIcon={fileIcon} /></span>
      {/* A long file name scrolls inside the plate instead of staying cut. */}
      <span className="presented-evidence-name"><OverflowMarquee text={evidence.name} active /></span>
    </div>
  )
}

interface PendingEvidenceProps {
  evidence: EvidenceDraft
  onRemove: () => void
  disabled?: boolean
}

/** Out-of-stage chip for the file about to be presented with the next message. */
export function PendingEvidence({ evidence, onRemove, disabled = false }: PendingEvidenceProps) {
  const t = useT()
  return (
    <div className="evidence-pending">
      <span className="evidence-pending-thumb" aria-hidden="true">
        {evidence.previewUrl
          ? <img src={evidence.previewUrl} alt="" draggable={false} />
          : <span>{evidenceBadge(evidence.kind, evidence.name)}</span>}
      </span>
      <span className="evidence-pending-text">
        <span className="evidence-pending-name">{evidence.name}</span>
        <span className="evidence-pending-size">{t('evidence.label')} · {formatSize(evidence.size)}</span>
      </span>
      <button type="button" onClick={onRemove} disabled={disabled} aria-label={t('evidence.remove', { name: evidence.name })}>✕</button>
    </div>
  )
}
