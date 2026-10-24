import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readStoredSettings, SettingsContext, writeStoredSettings, type Settings } from './settings.ts'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readStoredSettings)

  useEffect(() => writeStoredSettings(settings), [settings])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const value = useMemo(() => ({ settings, update }), [settings, update])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
