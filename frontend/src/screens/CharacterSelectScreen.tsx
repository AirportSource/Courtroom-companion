import { MenuList } from '../components/MenuList.tsx'
import { PixelStage } from '../components/PixelStage.tsx'
import { StageBackdrop } from '../components/StageBackdrop.tsx'
import type { CharacterId, CharacterSummary, UiImage } from '../engine/manifestTypes.ts'

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
  return (
    <PixelStage>
      <StageBackdrop image={backdrop} />
      <div className={backdrop ? 'menu-screen menu-screen-overlay' : 'menu-screen menu-screen-plain'}>
        <h1 className="menu-heading">Choose your character</h1>
        {characters.length === 0 ? (
          <p className="menu-empty">No characters found in characters/index.json.</p>
        ) : (
          <MenuList
            items={characters.map((c) => ({ id: c.id, label: c.displayName, imageUrl: c.previewUrl }))}
            initialId={selectedId ?? undefined}
            onSelect={onSelect}
            onBack={onBack}
            visibleRows={4}
          />
        )}
        <p className="menu-hint">Esc: back</p>
      </div>
    </PixelStage>
  )
}
