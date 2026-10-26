import type { LoadedCharacter, PresentationContext } from './manifestTypes.ts'

/** A presentation is a view of the same character. Stable poses are isolated to the
 * selected group; reactions may fall back to the shared character-level collection unless the
 * group sets `inheritReactions: false` (conversation never shows courtroom side views, D-091).
 * Missing contexts use the declared default, then the original legacy pack. */
export function selectPresentation(character: LoadedCharacter, context?: PresentationContext): LoadedCharacter {
  const groups = character.presentationGroups
  const group = (context ? groups?.[context] : undefined)
    ?? (character.defaultPresentation ? groups?.[character.defaultPresentation] : undefined)
  if (!group) return character
  const { inheritReactions = true, ...view } = group
  return { ...character, ...view, reactions: inheritReactions ? { ...character.reactions, ...group.reactions } : { ...group.reactions } }
}
