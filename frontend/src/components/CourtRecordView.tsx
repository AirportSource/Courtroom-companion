import { useEffect, useRef, useState } from 'react'
import { entriesOfType, type CourtRecordEntryType, type LoadedCourtRecord } from '../courtRecord/courtRecord.ts'
import {
  COURT_RECORD_TABS,
  GRID,
  cellOrigin,
  clampIndex,
  cycleTab,
  gridMove,
  gridRowCount,
  pageMove,
  scrollStart,
  type CourtRecordTab,
  type GridDirection,
} from '../courtRecord/courtRecordNav.ts'
import '../courtRecord/court-record.css'
import type { UiImage } from '../engine/manifestTypes.ts'
import { playMenuSound, type MenuSound } from '../engine/menuSounds.ts'
import { OverflowMarquee } from './OverflowMarquee.tsx'
import { StageBackdrop } from './StageBackdrop.tsx'

const TAB_LABELS: Record<CourtRecordTab, string> = { evidence: 'Evidence', profiles: 'Profiles' }
const TAB_TYPE: Record<CourtRecordTab, CourtRecordEntryType> = { evidence: 'evidence', profiles: 'profile' }
const EMPTY_TEXT: Record<CourtRecordTab, string> = { evidence: 'No evidence yet.', profiles: 'No profiles yet.' }
const ARROWS: Record<string, GridDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

interface CourtRecordViewProps {
  record: LoadedCourtRecord
  onClose: () => void
  /** Optional full-stage backdrop, drawn at (0, 0) at native size. */
  backdrop?: UiImage | null
}

/**
 * DS-style Court Record. Renders inside a PixelStage (256×192 logical px): evidence and profile
 * tabs, a grid of native-size icons, and the selected entry's name and description.
 *
 * Keyboard: arrows move, PageUp/PageDown move a page, Q/E or Tab switch tabs, Enter/Space/Z
 * confirm (sound only; details are always shown), Esc/Backspace/X close.
 */
export function CourtRecordView({ record, onClose, backdrop = null }: CourtRecordViewProps) {
  const [tab, setTab] = useState<CourtRecordTab>('evidence')
  const [index, setIndex] = useState(0)
  const [rowStart, setRowStart] = useState(0)
  const entries = entriesOfType(record, TAB_TYPE[tab])
  const selected = clampIndex(index, entries.length)
  const current = entries[selected]
  const rowCount = gridRowCount(entries.length)

  const select = (next: number, sound: MenuSound = 'menu_cursor') => {
    if (next !== selected) playMenuSound(sound)
    setIndex(next)
    setRowStart((previous) => scrollStart(Math.floor(next / GRID.columns), previous, GRID.rows, rowCount))
  }

  const switchTab = (next: CourtRecordTab) => {
    if (next === tab) return
    playMenuSound('menu_page')
    setTab(next)
    setIndex(0)
    setRowStart(0)
  }

  // Key and click handlers read the latest render through a ref, so the window listener is
  // attached once per change of selection rather than re-bound on every render.
  const actions = useRef({ select, switchTab, onClose })
  useEffect(() => {
    actions.current = { select, switchTab, onClose }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { select, switchTab, onClose } = actions.current
      const direction = ARROWS[event.key]
      if (direction) {
        select(gridMove(selected, entries.length, direction))
      } else if (event.key === 'PageDown' || event.key === 'PageUp') {
        select(pageMove(selected, entries.length, event.key === 'PageDown' ? 'next' : 'prev'), 'menu_page')
      } else if (event.key === 'q' || event.key === 'Q') {
        switchTab(cycleTab(tab, 'prev'))
      } else if (event.key === 'e' || event.key === 'E' || event.key === 'Tab') {
        switchTab(cycleTab(tab, event.shiftKey && event.key === 'Tab' ? 'prev' : 'next'))
      } else if (['Enter', ' ', 'z', 'Z'].includes(event.key)) {
        playMenuSound('menu_confirm')
      } else if (['Escape', 'Backspace', 'x', 'X'].includes(event.key)) {
        playMenuSound('menu_cancel')
        onClose()
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, selected, entries.length])

  return (
    <div className="cr-view" role="dialog" aria-label="Court Record" onClick={(event) => event.stopPropagation()}>
      {backdrop ? <StageBackdrop image={backdrop} /> : null}

      <div className="cr-tabs" role="tablist">
        {COURT_RECORD_TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={value === tab}
            className="cr-tab"
            onClick={() => actions.current.switchTab(value)}
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </div>

      <div className="cr-grid" role="listbox" aria-label={TAB_LABELS[tab]}>
        {entries.length === 0 ? <p className="cr-empty">{EMPTY_TEXT[tab]}</p> : null}
        {entries.map((entry, i) => {
          const column = i % GRID.columns
          const row = Math.floor(i / GRID.columns) - rowStart
          if (row < 0 || row >= GRID.rows) return null
          const { x, y } = cellOrigin(column, row)
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={i === selected}
              aria-label={entry.name}
              className="cr-cell"
              style={{ left: x, top: y }}
              onClick={(event) => {
                event.stopPropagation()
                actions.current.select(i)
              }}
            >
              <img
                className="cr-cell-icon"
                src={entry.image.url}
                width={entry.image.width}
                height={entry.image.height}
                alt=""
                draggable={false}
              />
            </button>
          )
        })}
      </div>

      <div className="cr-detail">
        {current ? (
          <>
            <p className="cr-detail-name">{current.name}</p>
            {/* Long descriptions scroll in whole pixels like menu labels (D-032); key resets per entry. */}
            <p className="cr-detail-text"><OverflowMarquee key={current.id} text={current.description} active /></p>
          </>
        ) : null}
      </div>
    </div>
  )
}
