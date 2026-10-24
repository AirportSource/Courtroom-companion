import { useEffect, useState } from 'react'
import { audioEngine } from '../engine/audioEngine.ts'
import { startPhoneRinging } from '../artifacts/phoneRinging.ts'
import { musicRuntime } from '../music/musicRuntime.ts'
import { useSettings } from '../settings/settings.ts'

/** Development-only audition; bounded and cleaned up when a real turn starts or the panel leaves. */
export function PhoneRingtoneAudition() {
  const [active, setActive] = useState(false)
  const { settings } = useSettings()
  useEffect(() => {
    if (!active || settings.sfxMuted || settings.sfxVolume <= 0) return
    const stop = startPhoneRinging(audioEngine, musicRuntime().engine, settings.sfxVolume, settings.ringtoneId)
    const timer = window.setTimeout(() => setActive(false), 45000)
    return () => { window.clearTimeout(timer); stop() }
  }, [active, settings.sfxMuted, settings.sfxVolume, settings.ringtoneId])
  return <div className="dev-buttons">
    <button type="button" disabled={settings.sfxMuted || settings.sfxVolume <= 0}
      onClick={() => { audioEngine.unlock(); setActive((value) => !value) }}>
      {active ? 'Stop ringtone' : 'Audition ringtone (45s)'}
    </button>
  </div>
}
