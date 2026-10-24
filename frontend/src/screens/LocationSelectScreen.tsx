import { useT } from '../i18n/useT.ts'
import { useState } from 'react'
import { BackgroundRenderer } from '../components/BackgroundRenderer.tsx'
import { MenuList } from '../components/MenuList.tsx'
import { PixelStage } from '../components/PixelStage.tsx'
import type { Background, BackgroundId } from '../engine/manifestTypes.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../engine/stage.ts'

interface LocationSelectScreenProps {
  backgrounds: Background[]
  selectedId: BackgroundId | null
  onSelect: (id: BackgroundId) => void
  onBack: () => void
}

function label(background: Background): string {
  const text = background.description || background.id
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Lists backgrounds.json; the highlighted location is previewed behind the menu. */
export function LocationSelectScreen({ backgrounds, selectedId, onSelect, onBack }: LocationSelectScreenProps) {
  const t = useT()
  const [previewId, setPreviewId] = useState<BackgroundId | null>(selectedId ?? backgrounds[0]?.id ?? null)
  const preview = backgrounds.find((bg) => bg.id === previewId) ?? null

  return (
    <PixelStage>
      <BackgroundRenderer background={preview} stageWidth={STAGE_WIDTH} stageHeight={STAGE_HEIGHT} />
      <div className="menu-screen menu-screen-overlay">
        <h1 className="menu-heading">{t('select.location')}</h1>
        <MenuList
          items={backgrounds.map((bg) => ({ id: bg.id, label: label(bg), sound: 'menu_start' as const }))}
          initialId={selectedId ?? undefined}
          onSelect={onSelect}
          onBack={onBack}
          onHighlight={setPreviewId}
          visibleRows={5}
        />
        <p className="menu-hint">{t('select.pageEscBack')}</p>
      </div>
    </PixelStage>
  )
}
