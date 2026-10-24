// Tool configuration client (D-067): authorized folders, web search provider/key, reminders.
// The web search key is sent once to the local backend (OS vault) and never comes back.

export interface ToolsStatus {
  folders: { id: string; name: string; path: string }[]
  webSearch: { provider: 'brave' | 'tavily' | null; configured: boolean; providers: Record<string, string> }
  reminders: { id: string; text: string; local: string }[]
}

const EMPTY: ToolsStatus = { folders: [], webSearch: { provider: null, configured: false, providers: {} }, reminders: [] }

export function parseToolsStatus(raw: unknown): ToolsStatus {
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const body = raw as Record<string, unknown>
  const strings = (value: unknown, keys: string[]) => typeof value === 'object' && value !== null
    && keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'string')
  const web = (typeof body.webSearch === 'object' && body.webSearch !== null ? body.webSearch : {}) as Record<string, unknown>
  return {
    folders: Array.isArray(body.folders) ? body.folders.filter((f) => strings(f, ['id', 'name', 'path'])) as ToolsStatus['folders'] : [],
    webSearch: {
      provider: web.provider === 'brave' || web.provider === 'tavily' ? web.provider : null,
      configured: web.configured === true,
      providers: typeof web.providers === 'object' && web.providers !== null ? web.providers as Record<string, string> : {},
    },
    reminders: Array.isArray(body.reminders) ? body.reminders.filter((r) => strings(r, ['id', 'text', 'local'])) as ToolsStatus['reminders'] : [],
  }
}

async function call(path: string, init?: RequestInit): Promise<ToolsStatus> {
  const response = await fetch(`/api/tools${path}`, {
    ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.detail?.message
    throw new Error(typeof message === 'string' ? message : `the server answered ${response.status}`)
  }
  return parseToolsStatus(body)
}

export const loadTools = () => call('')
export const addFolder = (path: string) => call('/folders', { method: 'POST', body: JSON.stringify({ path }) })
export const removeFolder = (id: string) => call(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const setSearchProvider = (provider: string | null) =>
  call('/web-search', { method: 'PUT', body: JSON.stringify({ provider }) })
export const setSearchKey = (secret: string) => call('/web-search/key', { method: 'PUT', body: JSON.stringify({ secret }) })
export const removeSearchKey = () => call('/web-search/key', { method: 'DELETE' })
export const cancelReminder = (id: string) => call(`/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' })
