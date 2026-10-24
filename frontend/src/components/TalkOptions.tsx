import { useEffect, useMemo, useRef, useState } from 'react'
import { scrollStart } from '../courtRecord/courtRecordNav.ts'
import {
  TALK_LIST,
  firstSelectable,
  isSelectable,
  moveSelection,
  pageSelection,
  sortTalkOptions,
  type TalkOption,
} from '../courtRecord/talkOptions.ts'
import '../courtRecord/court-record.css'
import type { UiImage } from '../engine/manifestTypes.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { StageBackdrop } from './StageBackdrop.tsx'
import { useT } from '../i18n/useT.ts'

interface TalkOptionsProps {
  options: TalkOption[]
  onSelect: (option: TalkOption) => void
  onCancel: () => void
  /** Optional full-stage backdrop (e.g. the DS talk-option panel), drawn at native size. */
  backdrop?: UiImage | null
}

/**
 * Generic DS-style Talk Options list. Renders inside a PixelStage. Disabled options are visible
 * but cannot be selected; cursor movement skips them.
 *
 * Keyboard: ↑/↓ move (wrapping, skipping disabled), PageUp/PageDown move a page, Enter/Space/Z
 * choose, Esc/Backspace/X cancel. Mouse: hover moves the cursor, click chooses.
 */
export function TalkOptions({ options, onSelect, onCancel, backdrop = null }: TalkOptionsProps) {
  const t = useT()
  const sorted = useMemo(() => sortTalkOptions(options), [options])
  const [stored, setStored] = useState(() => firstSelectable(sorted))
  const [listStart, setListStart] = useState(0)
  // Options can change under us: keep the cursor on a selectable row, else the first one.
  const selected = stored >= 0 && stored < sorted.length && isSelectable(sorted[stored]) ? stored : firstSelectable(sorted)

  const select = (next: number) => {
    if (next < 0 || next === selected) return
    playMenuSound('menu_cursor')
    setStored(next)
    setListStart((previous) => scrollStart(next, previous, TALK_LIST.visibleRows, sorted.length))
  }

  const choose = (option: TalkOption | undefined) => {
    if (!option || !isSelectable(option)) return
    playMenuSound('menu_confirm')
    onSelect(option)
  }

  // Key handlers read the latest render through a ref; see CourtRecordView for the same pattern.
  const actions = useRef({ select, choose, onCancel })
  useEffect(() => {
    actions.current = { select, choose, onCancel }
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { select, choose, onCancel } = actions.current
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        select(moveSelection(sorted, selected, event.key === 'ArrowDown' ? 1 : -1))
      } else if (event.key === 'PageDown' || event.key === 'PageUp') {
        const delta = event.key === 'PageDown' ? 1 : -1
        select(pageSelection(sorted, selected, delta, TALK_LIST.visibleRows))
      } else if (['Enter', ' ', 'z', 'Z'].includes(event.key)) {
        choose(selected >= 0 ? sorted[selected] : undefined)
      } else if (['Escape', 'Backspace', 'x', 'X'].includes(event.key)) {
        playMenuSound('menu_cancel')
        onCancel()
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sorted, selected])

  const visibleStart = scrollStart(selected < 0 ? 0 : selected, listStart, TALK_LIST.visibleRows, sorted.length)
  const visible = sorted.slice(visibleStart, visibleStart + TALK_LIST.visibleRows)

  return (
    <div className="to-view" onClick={(event) => event.stopPropagation()}>
      {backdrop ? <StageBackdrop image={backdrop} /> : null}
      <ul className="to-list" role="listbox" aria-label={t('talk.label')}>
        {visible.map((option, offset) => {
          const i = visibleStart + offset
          const isSelected = i === selected
          const enabled = isSelectable(option)
          return (
            <li
              key={option.id}
              role="option"
              aria-selected={isSelected}
              aria-disabled={!enabled}
              className="to-option"
              style={{ top: TALK_LIST.y + offset * TALK_LIST.rowHeight }}
              // mousemove, not mouseenter: a pointer resting on the list must not steal the cursor.
              onMouseMove={() => {
                if (enabled) actions.current.select(i)
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (!enabled) return
                actions.current.select(i)
                actions.current.choose(option)
              }}
            >
              {isSelected ? <span className="to-cursor" aria-hidden="true" /> : null}
              <span className="to-label">{option.label}</span>
              {option.isNew ? <span className="to-new">{t('talk.new')}</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
