import { useId, type ReactNode } from 'react'
import { useSettings } from '../settings/settings.ts'
import { isPanelExpanded, panelBodyMode, togglePanel } from './collapsiblePanel.ts'
import './CollapsiblePanel.css'

export interface CollapsiblePanelProps {
  /** Stable token (letters, digits, - and _; at most 56 chars) persisted in settings.expandedPanels. */
  id: string
  title: string
  defaultExpanded?: boolean
  /** Keep the body mounted (hidden and inert) while collapsed, e.g. for a media player. */
  keepMounted?: boolean
  /** Forces the panel open and disables the header toggle (e.g. a player that must stay visible). */
  locked?: boolean
  children: ReactNode
}

export function CollapsiblePanel({ id, title, defaultExpanded = false, keepMounted = false, locked = false,
  children }: CollapsiblePanelProps) {
  const { settings, update } = useSettings()
  const bodyId = useId()
  const expanded = locked || isPanelExpanded(settings.expandedPanels, id, defaultExpanded)
  const mode = panelBodyMode(expanded, keepMounted)
  return (
    <section className="collapsible-panel" data-expanded={expanded}>
      <button type="button" className="collapsible-panel__header" aria-expanded={expanded} aria-controls={bodyId}
        disabled={locked} onClick={() => update({ expandedPanels: togglePanel(settings.expandedPanels, id, defaultExpanded) })}>
        <span aria-hidden="true">{expanded ? '▼' : '▶'}</span> {title}
      </button>
      {mode !== 'omit' && <div id={bodyId} className="collapsible-panel__body" hidden={mode === 'hidden'}
        inert={mode === 'hidden'}>{children}</div>}
    </section>
  )
}
