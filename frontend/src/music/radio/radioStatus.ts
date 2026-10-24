import type { SourceState } from '../types.ts'

export function radioStatusText(state: SourceState, online: boolean): string {
  if (state.error?.code === 'network' || (!online && state.status !== 'playing')) return 'Offline'
  switch (state.status) {
    case 'loading':
      return 'Loading...'
    case 'playing':
      return 'Playing'
    case 'paused':
      return 'Paused'
    case 'blocked':
      return 'Autoplay blocked - press Play'
    case 'error':
      return state.error?.code === 'api_unavailable' ? 'YouTube player unavailable' : state.error?.message ?? 'Video unavailable'
    default:
      return 'Stopped'
  }
}
