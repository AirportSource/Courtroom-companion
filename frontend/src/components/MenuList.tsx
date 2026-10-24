import { useEffect, useRef, useState } from 'react'
import { playMenuSound, type MenuSound } from '../engine/menuSounds.ts'
import { OverflowMarquee } from './OverflowMarquee.tsx'

export interface MenuItem {
  id: string
  label: string
  /** Optional small image shown in the entry (e.g. a character preview frame). */
  imageUrl?: string | null
  /** Marks development-only entries visually. */
  dev?: boolean
  /** Sound when chosen; defaults to menu_confirm (use menu_open for submenus,
   * menu_start for launching the conversation). */
  sound?: MenuSound
}

interface MenuListProps {
  items: MenuItem[]
  onSelect: (id: string) => void
  onBack?: () => void
  onHighlight?: (id: string) => void
  initialId?: string
  /** Max entries visible before the list scrolls; PageUp/PageDown move by this much. */
  visibleRows?: number
  /** Height of one entry including its margin, in stage px (19 for text-only entries). */
  rowHeight?: number
}

/**
 * Vertical DS-style menu: mouse or keyboard (↑/↓, PageUp/PageDown, Enter/Space/Z,
 * Esc/Backspace/X), with logical menu sounds.
 */
export function MenuList({ items, onSelect, onBack, onHighlight, initialId, visibleRows = 6, rowHeight = 19 }: MenuListProps) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((item) => item.id === initialId)))
  // Label marquee: keyboard selection scrolls the selected label; with the mouse, only the
  // label under the pointer scrolls, and leaving it resets the text.
  const [inputMode, setInputMode] = useState<'keyboard' | 'pointer'>('keyboard')
  const [pointerItem, setPointerItem] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const handlers = useRef({ onSelect, onBack, onHighlight })
  useEffect(() => {
    handlers.current = { onSelect, onBack, onHighlight }
  })

  const current = items[Math.min(index, items.length - 1)]

  useEffect(() => {
    if (current) handlers.current.onHighlight?.(current.id)
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const choose = (item: MenuItem) => {
    playMenuSound(item.sound ?? 'menu_confirm')
    handlers.current.onSelect(item.id)
  }

  useEffect(() => {
    const move = (next: number, sound: MenuSound) => {
      setInputMode('keyboard')
      if (next !== index) {
        playMenuSound(sound)
        setIndex(next)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      const last = items.length - 1
      if (event.key === 'ArrowDown') move((index + 1) % items.length, 'menu_cursor')
      else if (event.key === 'ArrowUp') move((index - 1 + items.length) % items.length, 'menu_cursor')
      else if (event.key === 'PageDown') move(Math.min(last, index + visibleRows), 'menu_page')
      else if (event.key === 'PageUp') move(Math.max(0, index - visibleRows), 'menu_page')
      else if (['Enter', ' ', 'z', 'Z'].includes(event.key)) {
        if (current) choose(current)
      } else if (['Escape', 'Backspace', 'x', 'X'].includes(event.key)) {
        if (!handlers.current.onBack) return
        playMenuSound('menu_cancel')
        handlers.current.onBack()
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length, index, visibleRows, current])

  return (
    <ul className="menu-list" role="listbox" ref={listRef} style={{ maxHeight: visibleRows * rowHeight }}>
      {items.map((item, i) => (
        <li
          key={item.id}
          role="option"
          aria-selected={item === current}
          className={item.dev ? 'menu-item menu-item-dev' : 'menu-item'}
          // mousemove (not mouseenter): a pointer resting where a new menu appears must not
          // steal the keyboard selection.
          onMouseMove={() => {
            setInputMode('pointer')
            setPointerItem(item.id)
            if (i !== index) {
              playMenuSound('menu_cursor')
              setIndex(i)
            }
          }}
          onMouseLeave={() => setPointerItem(null)}
          onClick={(event) => {
            event.stopPropagation()
            choose(item)
          }}
        >
          {item.imageUrl && <img src={item.imageUrl} alt="" className="menu-item-image" />}
          <OverflowMarquee
            text={item.label}
            active={item === current && (inputMode === 'keyboard' || pointerItem === item.id)}
          />
        </li>
      ))}
    </ul>
  )
}
