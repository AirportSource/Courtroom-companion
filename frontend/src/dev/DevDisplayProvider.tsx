import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_DEV_DISPLAY,
  DevDisplayContext,
  readStoredDevDisplay,
  writeStoredDevDisplay,
  type DevDisplay,
} from './devDisplay.ts'

export function DevDisplayProvider({ children }: { children: ReactNode }) {
  // Production builds always use the defaults; stored dev choices apply only in dev.
  const [display, setDisplay] = useState<DevDisplay>(() =>
    import.meta.env.DEV ? readStoredDevDisplay() : DEFAULT_DEV_DISPLAY,
  )

  useEffect(() => {
    if (import.meta.env.DEV) writeStoredDevDisplay(display)
  }, [display])

  const update = useCallback((patch: Partial<DevDisplay>) => {
    setDisplay((current) => ({ ...current, ...patch }))
  }, [])

  const value = useMemo(() => ({ display, update }), [display, update])
  return <DevDisplayContext.Provider value={value}>{children}</DevDisplayContext.Provider>
}
