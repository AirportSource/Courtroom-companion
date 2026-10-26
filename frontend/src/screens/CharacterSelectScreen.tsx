import { MenuList } from '../components/MenuList.tsx'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import { listableCharacters } from '../engine/characterReadiness.ts'
import type { CharacterId, CharacterSummary, UiImage } from '../engine/manifestTypes.ts'
import { localizedName } from '../i18n/i18n.ts'
import { useT } from '../i18n/useT.ts'
import { useSettings } from '../settings/settings.ts'

interface CharacterSelectScreenProps {
  characters: CharacterSummary[]
  selectedId: CharacterId | null
  onSelect: (id: CharacterId) => void
  onBack: () => void
  /** Original DS panel behind the menu (ui.json); CSS gradient fallback when absent. */
  backdrop: UiImage | null
}

/**
 * Lists the registered characters that are ready (D-0xx readiness): production shows "ready" packs
 * only; development builds also show "partial" ones, marked. "asset-only" packs are never listed.
 * The list scrolls (MenuList), so any number of characters fits the 256×192 screen.
 */
export function CharacterSelectScreen({ characters, selectedId, onSelect, onBack, backdrop }: CharacterSelectScreenProps) {
  const t = useT()
  const { settings } = useSettings()
  const listed = listableCharacters(characters, Boolean(import.meta.env?.DEV))
  return (
    <PixelStage>
      <StageBackdrop image={backdrop} />
      <div className={backdrop ? 'menu-screen menu-screen-overlay' : 'menu-screen menu-screen-plain'}>
        <h1 className="menu-heading">{t('select.character')}</h1>
        {listed.length === 0 ? (
          <p className="menu-empty">{t('select.noCharacters')}</p>
        ) : (
          <MenuList
            items={listed.map((c) => ({
              id: c.id,
              // Marker first: long names are truncated until selected (D-032 marquee).
              label: (c.readiness === 'ready' ? '' : '[WIP] ') + localizedName(c, settings.language),
              imageUrl: c.previewUrl,
              dev: c.readiness !== 'ready',
            }))}
            initialId={selectedId ?? undefined}
            onSelect={onSelect}
            onBack={onBack}
            // Entries carry a 40px preview: 40 + 2×2 image margin + 2 border + 2 gap = 48px.
            visibleRows={2}
            rowHeight={48}
          />
        )}
        <p className="menu-hint">{t('select.escBack')}</p>
      </div>
    </PixelStage>
  )
}
