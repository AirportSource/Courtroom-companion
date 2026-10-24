import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playMenuSound } from '../engine/menuSounds.ts'
import { MenuList } from './MenuList.tsx'

export interface StageSelectOption {
  value: string
  label: string
}

const REOPEN_GUARD_MS = 400

interface StageSelectProps {
  /** Accessible name; also the heading of the open list. */
  label: string
  value: string
  options: StageSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * DS-style replacement for a native <select> inside the stage. A native select's list is a
 * browser popup drawn in screen pixels outside the scaled stage, in the system's look. This
 * one opens as a stage panel built on MenuList (same frames, keyboard, sounds and label
 * marquee as the menus). The panel is portalled into `.scene-stage`, so it covers the whole
 * stage, is never clipped by a scrolling form, and is not inside a wrapping <label> (which
 * would forward clicks on the list back to the trigger).
 */
export function StageSelect({ label, value, options, onChange, disabled = false }: StageSelectProps) {
  // The stage element to portal into while open; null when closed.
  const [host, setHost] = useState<Element | null>(null)
  const open = host !== null
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Space chooses on keydown; its keyup would then "click" the refocused trigger and reopen.
  const closedAt = useRef(0)
  const current = options.find((option) => option.value === value)

  const close = () => {
    closedAt.current = performance.now()
    setHost(null)
    triggerRef.current?.focus()
  }

  // Escape/Backspace/X close the list only: handled in the capture phase so screen-level
  // "back" listeners (e.g. Settings → Escape) never see them while the list is open.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (!['Escape', 'Backspace', 'x', 'X'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      playMenuSound('menu_cancel')
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="stage-select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (performance.now() - closedAt.current < REOPEN_GUARD_MS) return
          playMenuSound('menu_open')
          const trigger = triggerRef.current
          trigger?.blur() // Enter in the list must not re-activate this button.
          setHost(trigger?.closest('.scene-stage') ?? document.body)
        }}
      >
        <span className="stage-select-value">{current?.label ?? ''}</span>
        <span className="stage-select-arrow" aria-hidden="true" />
      </button>
      {host && createPortal(
        <div className="stage-select-backdrop" onClick={close}>
          <div className="stage-select-panel" role="dialog" aria-label={label} onClick={(event) => event.stopPropagation()}>
            <div className="stage-select-heading">{label}</div>
            <MenuList
              items={options.map((option) => ({ id: option.value, label: option.label }))}
              initialId={value}
              visibleRows={7}
              onSelect={(id) => {
                close()
                if (id !== value) onChange(id)
              }}
            />
          </div>
        </div>,
        host,
      )}
    </>
  )
}
