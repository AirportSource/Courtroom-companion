import { useEffect, useState } from 'react'
import { StageSelect } from '../components/StageSelect.tsx'
import { useT } from '../i18n/useT.ts'
import {
  addFolder, cancelReminder, loadTools, removeFolder, removeSearchKey, setSearchKey, setSearchProvider, type ToolsStatus,
} from './toolsApi.ts'

/** Settings section for character tools (D-067): folders, web search, pending reminders. */
export function ToolsPanel() {
  const t = useT()
  const [status, setStatus] = useState<ToolsStatus | null>(null)
  const [folderPath, setFolderPath] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    loadTools().then((next) => { if (live) setStatus(next) }, () => { if (live) setError(t('tools.unavailable')) })
    return () => { live = false }
  }, [t])

  const run = async (action: () => Promise<ToolsStatus>, after?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
      after?.()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return error ? <p className="settings-provider-status">{error}</p> : null
  const providers = [{ value: '', label: t('tools.searchNone') },
    ...Object.entries(status.webSearch.providers).map(([value, label]) => ({ value, label }))]

  return (
    <section className="settings-provider" aria-label={t('tools.heading')}>
      <h2 className="menu-heading settings-subheading">{t('tools.heading')}</h2>

      <div className="settings-row settings-row-field">
        <span>{t('tools.folders')}</span>
        <input aria-label={t('tools.folderPath')} placeholder={t('tools.folderPath')} value={folderPath} disabled={busy}
          onChange={(event) => setFolderPath(event.target.value)} />
      </div>
      <div className="settings-provider-actions">
        <button type="button" disabled={busy || !folderPath.trim()}
          onClick={() => void run(() => addFolder(folderPath), () => setFolderPath(''))}>{t('tools.add')}</button>
      </div>
      {status.folders.map((folder) => (
        <div key={folder.id} className="settings-row settings-row-field" title={folder.path}>
          <span>📁</span>
          <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
            <span className="tools-item-label">{folder.name}</span>
            <button type="button" disabled={busy} aria-label={t('tools.remove')}
              onClick={() => void run(() => removeFolder(folder.id))}>✕</button>
          </div>
        </div>
      ))}

      <div className="settings-row settings-row-field">
        <span>{t('tools.webSearch')}</span>
        <StageSelect label={t('tools.webSearch')} value={status.webSearch.provider ?? ''} options={providers} disabled={busy}
          onChange={(value) => void run(() => setSearchProvider(value || null))} />
      </div>
      {status.webSearch.provider && <>
        <div className="settings-row settings-row-field">
          <span>{t('tools.key')}</span>
          <input type="password" aria-label={t('tools.key')} autoComplete="off" value={key} disabled={busy}
            placeholder={t(status.webSearch.configured ? 'tools.configured' : 'tools.notConfigured')}
            onChange={(event) => setKey(event.target.value)} />
        </div>
        <div className="settings-provider-actions">
          <button type="button" disabled={busy || !key.trim()} onClick={() => void run(() => setSearchKey(key.trim()), () => setKey(''))}>{t('tools.save')}</button>
          {status.webSearch.configured && <button type="button" disabled={busy} onClick={() => void run(removeSearchKey)}>{t('tools.remove')}</button>}
        </div>
      </>}

      <div className="settings-row settings-row-field">
        <span>{t('tools.reminders')}</span>
        <span className="tools-item-label">{status.reminders.length ? '' : t('tools.noReminders')}</span>
      </div>
      {status.reminders.map((reminder) => (
        <div key={reminder.id} className="settings-row settings-row-field" title={reminder.text}>
          <span>{reminder.local.slice(5)}</span>
          <div style={{ display: 'flex', gap: 4, minWidth: 0 }}>
            <span className="tools-item-label">{reminder.text}</span>
            <button type="button" disabled={busy} aria-label={t('tools.remove')}
              onClick={() => void run(() => cancelReminder(reminder.id))}>✕</button>
          </div>
        </div>
      ))}
      {error && <p className="settings-provider-status" role="alert">{error}</p>}
    </section>
  )
}
