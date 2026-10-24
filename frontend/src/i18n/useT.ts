import { useMemo } from 'react'
import { useSettings } from '../settings/settings.ts'
import { translator, type Translate } from './i18n.ts'

/** Translation function for the current interface language. */
export function useT(): Translate {
  const { settings } = useSettings()
  return useMemo(() => translator(settings.language), [settings.language])
}
