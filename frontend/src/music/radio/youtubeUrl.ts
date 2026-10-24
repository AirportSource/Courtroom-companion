// Pure YouTube URL / video-ID parsing. Strict allow-list: anything that is not a
// recognised YouTube host (or a bare 11-char ID) is rejected.

const ID_RE = /^[A-Za-z0-9_-]{11}$/
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
const PATH_PREFIXES = ['embed', 'live', 'shorts', 'v']

export function isValidVideoId(id: string): boolean {
  return ID_RE.test(id)
}

/** Returns the 11-char video ID, or null when the input is not a supported YouTube reference. */
export function parseYouTubeVideoId(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > 2048) return null
  if (isValidVideoId(text)) return text

  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  let candidate: string | null = null
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = segments[0] ?? null
  } else if (HOSTS.has(host)) {
    if (segments[0] === 'watch') candidate = url.searchParams.get('v')
    else if (segments[0] && PATH_PREFIXES.includes(segments[0])) candidate = segments[1] ?? null
  }
  return candidate && isValidVideoId(candidate) ? candidate : null
}
