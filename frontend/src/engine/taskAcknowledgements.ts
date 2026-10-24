import type { DialogueLine } from './dialogueTypes.ts'

export interface TaskAcknowledgement {
  emotion: string
  lines: Record<string, string[]>
}
export type TaskAcknowledgements = Record<string, TaskAcknowledgement>

/** Optional character-pack presentation copy; no generated action or provider behavior. */
export function readTaskAcknowledgements(raw: unknown, emotions: Record<string, unknown>, defaultEmotion: string): TaskAcknowledgements {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: TaskAcknowledgements = {}
  for (const [task, value] of Object.entries(raw).slice(0, 16)) {
    if (!/^[a-z][a-z_]{0,63}$/.test(task) || !value || typeof value !== 'object') continue
    const block = value as Record<string, unknown>
    if (!block.lines || typeof block.lines !== 'object' || Array.isArray(block.lines)) continue
    const lines: Record<string, string[]> = {}
    for (const [locale, entries] of Object.entries(block.lines)) {
      if (!/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale) || !Array.isArray(entries)) continue
      const valid = entries.filter((line): line is string => typeof line === 'string' && !!line.trim() && line.length <= 200)
      if (valid.length) lines[locale.toLowerCase()] = valid.slice(0, 8).map((line) => line.trim())
    }
    if (Object.keys(lines).length) result[task] = {
      emotion: typeof block.emotion === 'string' && emotions[block.emotion] ? block.emotion : defaultEmotion, lines,
    }
  }
  return result
}

/** Rotate short local variants; use the known presentation locale, then the pack's English/default. */
export function taskAcknowledgement(
  character: { taskAcknowledgements?: TaskAcknowledgements }, task: string, locale: string, sequence: number,
): DialogueLine | null {
  const block = character.taskAcknowledgements?.[task]
  if (!block) return null
  const language = locale.toLowerCase()
  const lines = block.lines[language] ?? block.lines[language.split('-')[0]] ?? block.lines.en ?? Object.values(block.lines)[0]
  if (!lines?.length) return null
  return { text: lines[Math.abs(Math.floor(sequence)) % lines.length], emotion: block.emotion, reaction: null, sfx: null }
}
