import { MenuList } from '../components/MenuList.tsx'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
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

/** Lists every character registered in characters/index.json. */
export function CharacterSelectScreen({ characters, selectedId, onSelect, onBack, backdrop }: CharacterSelectScreenProps) {
  const t = useT()
  const { settings } = useSettings()
  return (
    <PixelStage>
      <StageBackdrop image={backdrop} />
      <div className={backdrop ? 'menu-screen menu-screen-overlay' : 'menu-screen menu-screen-plain'}>
        <h1 className="menu-heading">{t('select.character')}</h1>
        {characters.length === 0 ? (
          <p className="menu-empty">{t('select.noCharacters')}</p>
        ) : (
          <MenuList
            items={characters.map((c) => ({ id: c.id, label: localizedName(c, settings.language), imageUrl: c.previewUrl }))}
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
