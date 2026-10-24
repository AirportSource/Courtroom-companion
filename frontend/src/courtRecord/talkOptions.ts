// Pure model for the Talk Options list: ordering, selectable-state and cursor movement. Options are
// generic (no character-specific topics); callers supply the labels.

export interface TalkOption {
  id: string
  label: string
  /** Disabled options are shown but cannot be chosen or selected. Defaults to true. */
  enabled?: boolean
  /** Shows the "new" marker. */
  isNew?: boolean
  /** Lower values come first. Options without an order sort as 0, keeping their input order. */
  order?: number
}

/** Logical layout of the list over the talk-option backdrop (256×192). */
export const TALK_LIST = {
  x: 16,
  y: 24,
  rowHeight: 16,
  visibleRows: 8,
}

export function isSelectable(option: TalkOption): boolean {
  return option.enabled !== false
}

/** Stable sort by `order`, then by original position. Never mutates the input. */
export function sortTalkOptions(options: readonly TalkOption[]): TalkOption[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => (a.option.order ?? 0) - (b.option.order ?? 0) || a.index - b.index)
    .map(({ option }) => option)
}

/** Index of the first selectable option, or -1 when none can be chosen. */
export function firstSelectable(options: readonly TalkOption[]): number {
  return options.findIndex(isSelectable)
}

/**
 * Next selectable index from `index` in direction `delta` (wrapping, like the DS menus), skipping
 * disabled options. Returns -1 when no option is selectable.
 */
export function moveSelection(options: readonly TalkOption[], index: number, delta: 1 | -1): number {
  const count = options.length
  for (let step = 1; step <= count; step++) {
    const candidate = (((index + delta * step) % count) + count) % count
    if (isSelectable(options[candidate])) return candidate
  }
  return -1
}

/**
 * PageUp/PageDown: jumps `step` rows in direction `delta`, then lands on the nearest selectable
 * option at or beyond that point. Unlike moveSelection this never wraps; with nothing further in
 * that direction the cursor stays where it is.
 */
export function pageSelection(options: readonly TalkOption[], index: number, delta: 1 | -1, step: number): number {
  if (options.length === 0) return -1
  const target = Math.min(options.length - 1, Math.max(0, index + delta * step))
  for (let i = target; i >= 0 && i < options.length; i += delta) {
    if (isSelectable(options[i])) return i
  }
  return index
}
