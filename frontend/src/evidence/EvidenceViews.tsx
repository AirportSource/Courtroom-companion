import type { UiImage } from '../engine/manifestTypes.ts'
import { EvidenceTile } from '../courtRecord/EvidenceTile.tsx'
import { evidenceBadge, formatSize, type EvidenceDraft } from './evidence.ts'
import { useT } from '../i18n/useT.ts'
import './evidence.css'

/** Window content: the photo fitted into 64×64, or the file icon with a type badge. */
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
  frame: UiImage | null
  fileIcon: UiImage | null
}

/** In-stage box shown while the character examines what the user presented (DS "present" box). */
export function PresentedEvidence({ evidence, frame, fileIcon }: PresentedEvidenceProps) {
  const t = useT()
  return (
    <div className="presented-evidence" role="status" aria-label={t('evidence.presented', { name: evidence.name })}>
      <EvidenceTile frame={frame}><EvidenceFace evidence={evidence} fileIcon={fileIcon} /></EvidenceTile>
      <span className="presented-evidence-name">{evidence.name}</span>
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
