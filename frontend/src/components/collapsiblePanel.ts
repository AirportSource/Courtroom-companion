// Pure state rules for CollapsiblePanel. Expanded state lives in settings.expandedPanels, a list of
// SAFE_ID-shaped tokens: `id` = expanded, `off_<id>` = collapsed by the user although the panel
// expands by default. Anything else (unknown ids, other panels) is left untouched.

export const MAX_EXPANDED_PANELS = 32
const OFF_PREFIX = 'off_'

export function isPanelExpanded(stored: readonly string[], id: string, defaultExpanded = false): boolean {
  if (defaultExpanded) return !stored.includes(OFF_PREFIX + id)
  return stored.includes(id)
}

/** Returns the new stored list with `id` set to `expanded`, keeping the list minimal and bounded. */
export function setPanelExpanded(stored: readonly string[], id: string, expanded: boolean, defaultExpanded = false): string[] {
  const rest = stored.filter((token) => token !== id && token !== OFF_PREFIX + id)
  const token = expanded === defaultExpanded ? null : defaultExpanded ? OFF_PREFIX + id : id
  return (token ? [...rest, token] : rest).slice(-MAX_EXPANDED_PANELS)
}

export function togglePanel(stored: readonly string[], id: string, defaultExpanded = false): string[] {
  return setPanelExpanded(stored, id, !isPanelExpanded(stored, id, defaultExpanded), defaultExpanded)
}

/**
 * How the body is emitted: 'render' (visible), 'hidden' (kept mounted but hidden + inert, for
 * content that must keep running such as a media player) or 'omit' (not in the tree at all).
 */
export function panelBodyMode(expanded: boolean, keepMounted: boolean): 'render' | 'hidden' | 'omit' {
  return expanded ? 'render' : keepMounted ? 'hidden' : 'omit'
}
