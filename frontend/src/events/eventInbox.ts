// Event inbox client (D-067): things the character comments on without a user message (Claude Code
// hooks, due reminders). The backend resolves each event into a ready performance for the character
// on screen and the interface language; this module polls and queues them.
import { useCallback, useEffect, useState } from 'react'
import { parseChatResponse, type PerformanceTimeline } from '../engine/performance.ts'

export type Exclamation = 'objection' | 'hold_it' | 'take_that'

export interface InboxEvent {
  id: number
  type: string
  source: string
  project: string
  /** Ring the phone first (Claude Code waiting, a reminder). */
  attention: boolean
  exclamation: Exclamation | null
  performance: PerformanceTimeline
}

export const POLL_MS = 2000
const EXCLAMATIONS: readonly string[] = ['objection', 'hold_it', 'take_that']

/** Validates a GET /api/events body; malformed events are dropped. */
export function parseInboxEvents(raw: unknown): { cursor: number; events: InboxEvent[] } {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const cursor = typeof body.cursor === 'number' && Number.isInteger(body.cursor) && body.cursor >= 0 ? body.cursor : 0
  const events = (Array.isArray(body.events) ? body.events : []).flatMap((item): InboxEvent[] => {
    if (typeof item !== 'object' || item === null) return []
    const event = item as Record<string, unknown>
    if (typeof event.id !== 'number' || typeof event.type !== 'string') return []
    try {
      return [{
        id: event.id,
        type: event.type,
        source: typeof event.source === 'string' ? event.source : '',
        project: typeof event.project === 'string' ? event.project : '',
        attention: event.attention === true,
        exclamation: typeof event.exclamation === 'string' && EXCLAMATIONS.includes(event.exclamation)
          ? event.exclamation as Exclamation : null,
        performance: parseChatResponse({ performance: event.performance }).performance,
      }]
    } catch {
      return []
    }
  })
  return { cursor, events }
}

/**
 * Polls the inbox while `enabled`. The first request only fetches the current cursor, so opening
 * a conversation never replays old events. Returns the queued events (oldest first) and `take`,
 * which removes the oldest one.
 */
export function useEventInbox(characterId: string, language: string, enabled = true) {
  const [queue, setQueue] = useState<InboxEvent[]>([])

  useEffect(() => {
    if (!enabled) return
    let cursor = 0
    let stopped = false
    let timer = 0
    const poll = async () => {
      try {
        const query = new URLSearchParams({ character: characterId, after: String(cursor), language })
        const response = await fetch(`/api/events?${query}`, { cache: 'no-store' })
        if (response.ok) {
          const { cursor: next, events } = parseInboxEvents(await response.json())
          if (!stopped && next >= cursor) {
            cursor = next
            if (events.length) setQueue((current) => [...current, ...events].slice(-10))
          }
        }
      } catch {
        // Backend restarting or offline: try again on the next tick.
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [characterId, language, enabled])

  const take = useCallback(() => setQueue((current) => current.slice(1)), [])
  return { queue, take }
}
