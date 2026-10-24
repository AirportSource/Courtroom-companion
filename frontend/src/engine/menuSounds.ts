import { audioEngine } from './audioEngine.ts'

/**
 * Logical menu sound events. Each maps to a sound id through audio.json "events";
 * components never reference physical sound files.
 */
export type MenuSound =
  | 'menu_cursor'
  | 'menu_confirm'
  | 'menu_cancel'
  | 'menu_open'
  | 'menu_page'
  | 'menu_save'
  | 'menu_start'

export const MENU_SOUNDS: MenuSound[] = [
  'menu_cursor',
  'menu_confirm',
  'menu_cancel',
  'menu_open',
  'menu_page',
  'menu_save',
  'menu_start',
]

/** UI effects play at a fixed level for now (no separate UI volume setting yet). */
const MENU_VOLUME = 0.5

export function playMenuSound(sound: MenuSound): void {
  audioEngine.playEvent(sound, MENU_VOLUME)
}
