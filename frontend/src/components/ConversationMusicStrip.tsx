import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { UiImage } from '../engine/manifestTypes.ts'
import { playMenuSound } from '../engine/menuSounds.ts'
import { OverflowMarquee } from './OverflowMarquee.tsx'
import { enabledControls, showsPause, type ConversationMusicView, type MusicControl } from './conversationMusicView.ts'
import './ConversationMusicStrip.css'

export interface ConversationMusicImages {
  note: UiImage | null
  play: UiImage | null
  pause: UiImage | null
  next: UiImage | null
  prev: UiImage | null
  playHot: UiImage | null
  pauseHot: UiImage | null
  nextHot: UiImage | null
  prevHot: UiImage | null
}

interface ConversationMusicStripProps {
  view: ConversationMusicView
  images: ConversationMusicImages
  labels: { open: string; close: string; prev: string; play: string; pause: string; next: string; theme: string; list: string }
}

/**
 * Compact Trilogy-music-player strip in stage pixels: a note tab (always visible, bottom-right above
 * the dialogue box) opens a one-line strip with the track title and prev / play-pause / next / list /
 * theme. The list button opens an in-stage track menu above the strip, so a far-away track is one
 * pick instead of many "next" presses.
 * Presentational: the view and its handlers come from an adapter; no engine access here.
 */
export function ConversationMusicStrip({ view, images, labels }: ConversationMusicStripProps) {
  const [open, setOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const enabled = enabledControls(view)
  const showList = open && listOpen && enabled.list
  // Opening the list brings the current track into view and gives it keyboard focus.
  useEffect(() => {
    if (!showList) return
    const current = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?? listRef.current?.querySelector<HTMLButtonElement>('button')
    current?.scrollIntoView({ block: 'center' })
    current?.focus({ preventScroll: true })
  }, [showList])
  const pause = showsPause(view.status)
  // Clicks here must not advance the dialogue behind the stage.
  const stop = (event: MouseEvent) => event.stopPropagation()
  const press = (control: MusicControl, action: (() => void) | undefined) => {
    if (!enabled[control] || !action) return
    playMenuSound('menu_cursor')
    action()
  }
  const glyph = (image: UiImage | null, fallback: string) => image
    ? <img className="music-strip__glyph" src={image.url} width={image.width} height={image.height} alt="" draggable={false} />
    : <span aria-hidden="true">{fallback}</span>
  const note = images.note
    ? <img src={images.note.url} width={images.note.width} height={images.note.height} alt="" draggable={false} />
    : <span aria-hidden="true">{'♪'}</span>

  const choose = (trackId: string) => {
    playMenuSound('menu_confirm')
    setListOpen(false)
    if (trackId !== view.currentTrackId) view.onSelect?.(trackId)
  }
  const listKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      playMenuSound('menu_cancel')
      setListOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = items[Math.min(items.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (next && next !== items[at]) playMenuSound('menu_cursor')
      next?.focus()
    }
  }

  if (!open) {
    return (
      <button type="button" className="music-strip__tab" aria-label={labels.open} aria-expanded="false"
        onClick={(event) => { stop(event); playMenuSound('menu_open'); setOpen(true) }}>{note}</button>
    )
  }
  const control = (id: MusicControl, label: string, image: UiImage | null, hot: UiImage | null, fallback: string, action?: () => void) => (
    <button type="button" className="music-strip__button" aria-label={label} title={label} disabled={!enabled[id]}
      style={hot ? ({ '--hot': `url(${hot.url})` } as CSSProperties) : undefined}
      onClick={(event) => { stop(event); press(id, action) }}>{glyph(image, fallback)}</button>
  )
  return (
    <div className="music-strip" role="group" aria-label={labels.close} onClick={stop}>
      <button type="button" className="music-strip__tab music-strip__tab--close" aria-label={labels.close} aria-expanded="true"
        onClick={(event) => { stop(event); playMenuSound('menu_cancel'); setOpen(false); setListOpen(false) }}>{note}</button>
      <span className="music-strip__title" aria-live="off"><OverflowMarquee text={view.title || '—'} active /></span>
      {control('prev', labels.prev, images.prev, images.prevHot, '⏮', view.onPrev)}
      {control('toggle', pause ? labels.pause : labels.play, pause ? images.pause : images.play,
        pause ? images.pauseHot : images.playHot, pause ? '||' : '▶', view.onToggle)}
      {control('next', labels.next, images.next, images.nextHot, '⏭', view.onNext)}
      <button type="button" className="music-strip__list-toggle" aria-label={labels.list} title={labels.list}
        aria-haspopup="listbox" aria-expanded={showList} disabled={!enabled.list}
        onClick={(event) => {
          stop(event)
          if (!enabled.list) return
          playMenuSound(showList ? 'menu_cancel' : 'menu_open')
          setListOpen(!showList)
        }}>{'≡'}</button>
      <button type="button" className="music-strip__theme" disabled={!enabled.theme}
        onClick={(event) => { stop(event); press('theme', view.onTheme) }}>{labels.theme}</button>
      {showList && (
        <div className="music-strip__list" role="listbox" aria-label={labels.list} ref={listRef}
          onClick={stop} onKeyDown={listKeys}>
          {(view.tracks ?? []).map((track) => (
            <button key={track.id} type="button" role="option" className="music-strip__item"
              aria-selected={track.id === view.currentTrackId} onClick={(event) => { stop(event); choose(track.id) }}>
              <span className="music-strip__item-mark" aria-hidden="true">{track.id === view.currentTrackId ? '▶' : ''}</span>
              <span className="music-strip__item-label">{track.label}</span>
              {track.isTheme && <span className="music-strip__item-theme" title={labels.theme}>{'★'}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
