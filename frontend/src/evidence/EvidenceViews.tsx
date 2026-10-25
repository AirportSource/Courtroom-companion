import { useState } from 'react'
import type { UiImage } from '../engine/manifestTypes.ts'
import { evidenceBadge, formatSize, type EvidenceDraft } from './evidence.ts'
import { OverflowMarquee } from '../components/OverflowMarquee.tsx'
import { useT } from '../i18n/useT.ts'
import './evidence.css'

/**
 * The presented picture itself; if the browser cannot show it (unreadable or broken file), the
 * game's photo evidence icon takes its place (D-075), and the type badge only without that icon.
 */
function EvidencePicture({ evidence, photoIcon, className }: {
  evidence: EvidenceDraft; photoIcon: UiImage | null; className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  if (evidence.previewUrl && failed !== evidence.previewUrl) {
    const url = evidence.previewUrl
    return <img className={className} src={url} alt="" draggable={false} onError={() => setFailed(url)} />
  }
  if (photoIcon) return <img className="evidence-photo-icon" src={photoIcon.url} alt="" draggable={false} />
  return <span>{evidenceBadge(evidence.kind, evidence.name)}</span>
}

/** Window content: the picture filling 64×64, or the file icon with a type badge. */
function EvidenceFace({ evidence, fileIcon, photoIcon }: {
  evidence: EvidenceDraft; fileIcon: UiImage | null; photoIcon: UiImage | null
}) {
  if (evidence.kind === 'image') return <EvidencePicture evidence={evidence} photoIcon={photoIcon} className="evidence-photo" />
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
  photoIcon: UiImage | null
}

/**
 * In-stage card shown while the character examines what the user presented (DS "present" box):
 * the dialogue box's double border around a 64×64 window, the photo cropped to fill it (no
 * letterbox bars), and the name in a nameplate strip along the bottom.
 */
export function PresentedEvidence({ evidence, fileIcon, photoIcon }: PresentedEvidenceProps) {
  const t = useT()
  return (
    <div className="presented-evidence" role="status" aria-label={t('evidence.presented', { name: evidence.name })}>
      <span className="presented-evidence-window" aria-hidden="true"><EvidenceFace evidence={evidence} fileIcon={fileIcon} photoIcon={photoIcon} /></span>
      {/* A long file name scrolls inside the plate instead of staying cut. */}
      <span className="presented-evidence-name"><OverflowMarquee text={evidence.name} active /></span>
    </div>
  )
}

interface PendingEvidenceProps {
  evidence: EvidenceDraft
  photoIcon: UiImage | null
  onRemove: () => void
  disabled?: boolean
}

/** Out-of-stage chip for the file about to be presented with the next message. */
export function PendingEvidence({ evidence, photoIcon, onRemove, disabled = false }: PendingEvidenceProps) {
  const t = useT()
  return (
    <div className="evidence-pending">
      <span className="evidence-pending-thumb" aria-hidden="true">
        {evidence.kind === 'image'
          ? <EvidencePicture evidence={evidence} photoIcon={photoIcon} />
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
