export interface OllamaModel {
  name: string
  model: string
  parameterSize: string | null
  quantizationLevel: string | null
  size: number | null
}

export interface OllamaConnectionResult {
  status: 'selected_model_missing' | 'generation_failed' | 'generation_succeeded'
  reachable: boolean
  modelsLoaded: boolean
  generationSucceeded: boolean
  error?: string
  models: OllamaModel[]
}

export type OpenAICompatibleConnectionStatus =
  | 'auth_not_configured'
  | 'auth_failed'
  | 'rate_limited'
  | 'model_error'
  | 'structured_output_failed'
  | 'timeout'
  | 'unreachable'
  | 'generation_failed'
  | 'generation_succeeded'

export interface OpenAICompatibleConnectionResult {
  status: OpenAICompatibleConnectionStatus
  apiKeyConfigured: boolean
  generationSucceeded: boolean
  error?: string
}

export class ProviderApiError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.code = code
  }
}

function parseModel(raw: unknown): OllamaModel | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name : null
  const model = typeof value.model === 'string' ? value.model : name
  if (!name || !model) return null
  return {
    name,
    model,
    parameterSize: typeof value.parameterSize === 'string' ? value.parameterSize : null,
    quantizationLevel: typeof value.quantizationLevel === 'string' ? value.quantizationLevel : null,
    size: typeof value.size === 'number' ? value.size : null,
  }
}

export async function backendJson(path: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, { ...init, signal: controller.signal })
    const raw: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const detail =
        typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).detail === 'object'
          ? ((raw as Record<string, unknown>).detail as Record<string, unknown>)
          : null
      const code = detail && typeof detail.code === 'string' ? detail.code : null
      const message = detail && typeof detail.message === 'string' ? detail.message : `the server answered ${response.status}`
      throw new ProviderApiError(message, code)
    }
    if (typeof raw !== 'object' || raw === null) throw new ProviderApiError('the server returned an invalid response')
    return raw as Record<string, unknown>
  } catch (error) {
    if (error instanceof ProviderApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProviderApiError('the connection test timed out', 'timeout')
    }
    throw new ProviderApiError(error instanceof Error ? error.message : 'could not reach the backend')
  } finally {
    window.clearTimeout(timer)
  }
}

export function modelsFrom(raw: Record<string, unknown>): OllamaModel[] {
  return (Array.isArray(raw.models) ? raw.models : []).flatMap((model) => {
    const parsed = parseModel(model)
    return parsed ? [parsed] : []
  })
}

export async function fetchOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  const query = new URLSearchParams({ baseUrl })
  const body = await backendJson(`/api/providers/ollama/models?${query}`, {}, 15_000)
  return modelsFrom(body)
}

export async function testOllamaConnection(
  baseUrl: string,
  model: string,
  character: string,
): Promise<OllamaConnectionResult> {
  const body = await backendJson(
    '/api/providers/ollama/test',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, model, character }),
    },
    135_000,
  )
  const status = body.status
  if (!['selected_model_missing', 'generation_failed', 'generation_succeeded'].includes(String(status))) {
    throw new ProviderApiError('the server returned an invalid connection-test result')
  }
  return {
    status: status as OllamaConnectionResult['status'],
    reachable: body.reachable === true,
    modelsLoaded: body.modelsLoaded === true,
    generationSucceeded: body.generationSucceeded === true,
    error: typeof body.error === 'string' ? body.error : undefined,
    models: modelsFrom(body),
  }
}

export async function fetchOpenAICompatibleStatus(): Promise<boolean> {
  const body = await backendJson('/api/providers/openai-compatible/status', {}, 15_000)
  return body.apiKeyConfigured === true
}

export async function testOpenAICompatibleConnection(
  baseUrl: string,
  model: string,
  character: string,
): Promise<OpenAICompatibleConnectionResult> {
  const body = await backendJson(
    '/api/providers/openai-compatible/test',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, model, character }),
    },
    135_000,
  )
  const statuses: OpenAICompatibleConnectionStatus[] = [
    'auth_not_configured',
    'auth_failed',
    'rate_limited',
    'model_error',
    'structured_output_failed',
    'timeout',
    'unreachable',
    'generation_failed',
    'generation_succeeded',
  ]
  const status = String(body.status)
  if (!statuses.includes(status as OpenAICompatibleConnectionStatus)) {
    throw new ProviderApiError('the server returned an invalid connection-test result')
  }
  return {
    status: status as OpenAICompatibleConnectionStatus,
    apiKeyConfigured: body.apiKeyConfigured === true,
    generationSucceeded: body.generationSucceeded === true,
    error: typeof body.error === 'string' ? body.error : undefined,
  }
}
