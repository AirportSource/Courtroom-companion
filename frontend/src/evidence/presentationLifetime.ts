import { releaseEvidence, type EvidenceDraft } from './evidence.ts'

/** Owns only the preview transferred to a submitted turn, never the next pending attachment. */
export class EvidencePresentationLifetime {
  private current: { turnId: string; evidence: EvidenceDraft } | null = null
  private release: (evidence: EvidenceDraft) => void

  constructor(release: (evidence: EvidenceDraft) => void = releaseEvidence) {
    this.release = release
  }

  begin(turnId: string, evidence: EvidenceDraft | null): EvidenceDraft | null {
    this.clear()
    this.current = evidence ? { turnId, evidence } : null
    return evidence
  }

  /** A late response from a departed turn cannot release a newer turn's preview. */
  finish(turnId: string): boolean {
    if (this.current?.turnId !== turnId) return false
    this.clear()
    return true
  }

  clear(): void {
    const previous = this.current
    this.current = null
    if (previous) this.release(previous.evidence)
  }
}
