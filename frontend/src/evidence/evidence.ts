// Files the user presents to the character as evidence. The backend decides the real kind from
// the bytes and enforces the limits; this module only gives early, friendly feedback and
// encodes the file for POST /api/chat.

import { translate, type Language } from '../i18n/i18n.ts'

export type EvidenceKind = 'text' | 'image' | 'pdf'

export interface EvidenceDraft {
  name: string
  size: number
  kind: EvidenceKind
  /** Base64 file bytes, sent as `evidence.data`. */
  data: string
  /** Object URL for image thumbnails (revoke with releaseEvidence). */
  previewUrl: string | null
}

/** Same limits as backend/app/llm/attachments.py. */
export const EVIDENCE_LIMITS = { text: 400_000, image: 5 * 1024 * 1024, pdf: 10 * 1024 * 1024 } as const

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i
const BINARY_EXTENSIONS = /\.(zip|rar|7z|exe|dll|bin|docx?|xlsx?|pptx?|odt|mp3|wav|ogg|mp4|mov|avi|bmp|tiff?|heic|svg)$/i

/** Best guess from the browser's metadata; the server re-checks the bytes. */
export function evidenceKind(file: Pick<File, 'name' | 'type'>): EvidenceKind | null {
  if (IMAGE_TYPES.includes(file.type) || IMAGE_EXTENSIONS.test(file.name)) return 'image'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (BINARY_EXTENSIONS.test(file.name) || /^(audio|video)\//.test(file.type) || file.type.startsWith('image/')) return null
  return 'text'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TOO_LARGE = { text: 'evidence.tooLargeText', image: 'evidence.tooLargeImage', pdf: 'evidence.tooLargePdf' } as const

/** User-facing reason this file cannot be presented, or null when it may be sent. */
export function evidenceProblem(file: Pick<File, 'name' | 'type' | 'size'>, language: Language = 'en'): string | null {
  const kind = evidenceKind(file)
  if (!kind) return translate(language, 'evidence.unsupported')
  if (file.size === 0) return translate(language, 'evidence.empty')
  if (file.size > EVIDENCE_LIMITS[kind]) return translate(language, TOO_LARGE[kind])
  return null
}

/**
 * Whether the bytes really are what the file claims, with the server's own signature checks
 * (llm/attachments.py). A damaged or renamed file is refused when it is attached, with a precise
 * message, instead of after sending as "Unsupported file".
 */
export function contentMatchesKind(kind: EvidenceKind, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const ascii = (text: string, offset = 0) => [...text].every((ch, index) => bytes[offset + index] === ch.charCodeAt(0))
  if (kind === 'image') {
    return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) || starts(0xff, 0xd8, 0xff)
      || ascii('GIF87a') || ascii('GIF89a') || (ascii('RIFF') && ascii('WEBP', 8))
  }
  if (kind === 'pdf') return ascii('%PDF-')
  return true
}

/** Base64 of raw bytes, chunked so large files do not overflow the argument limit. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export async function readEvidence(file: File, language: Language = 'en'): Promise<EvidenceDraft> {
  const problem = evidenceProblem(file, language)
  if (problem) throw new Error(problem)
  const kind = evidenceKind(file) as EvidenceKind
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!contentMatchesKind(kind, bytes)) {
    throw new Error(translate(language, kind === 'image' ? 'evidence.damagedImage' : 'evidence.damagedPdf'))
  }
  const data = toBase64(bytes)
  return { name: file.name, size: file.size, kind, data, previewUrl: kind === 'image' ? URL.createObjectURL(file) : null }
}

export function releaseEvidence(draft: EvidenceDraft | null): void {
  if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl)
}

/** Short badge for files without a thumbnail. */
export function evidenceBadge(kind: EvidenceKind, name: string): string {
  if (kind === 'pdf') return 'PDF'
  const extension = /\.([a-z0-9]{1,4})$/i.exec(name)?.[1]
  return kind === 'text' ? (extension ?? 'TXT').toUpperCase() : 'IMG'
}
