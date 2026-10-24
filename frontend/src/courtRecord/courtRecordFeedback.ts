import type { MenuSound } from '../engine/menuSounds.ts'
import { GENERATED_GRID } from './generatedFiles.ts'

/** Browsing uses ordinary menu events only; rapid held-key movement is rate limited. */
export function createCourtRecordFeedback(play: (event: MenuSound) => void, now = () => performance.now()) {
  let lastMove = -Infinity
  return {
    move(from: number, to: number) {
      if (from === to || now() - lastMove < 140) return
      lastMove = now()
      play(Math.floor(from / GENERATED_GRID.pageSize) !== Math.floor(to / GENERATED_GRID.pageSize) ? 'menu_page' : 'menu_cursor')
    },
    confirm: () => play('menu_confirm'),
    back: () => play('menu_cancel'),
  }
}
