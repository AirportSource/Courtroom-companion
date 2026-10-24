// Developer-facing loop preview: plays the last few seconds before the loop end, jumps to the loop
// start, plays a few seconds, and repeats. It uses a small excerpt (never a copy of the whole track)
// on the AudioContext it is given, and is fully stopped by stop().
import type { EditorLoop } from './loopEditorState.ts'

export interface PreviewExcerpt {
  channels: Float32Array[]
  /** Index where the loop end hands over to the loop start (the seam under test). */
  seamIndex: number
}

const EDGE_RAMP_SECONDS = 0.004

/**
 * Excerpt = [end - preRoll, end) followed by [start, start + postRoll), with the optional
 * equal-power seam crossfade baked in and tiny ramps at the artificial wrap-around only.
 */
export function buildPreviewExcerpt(
  channels: Float32Array[],
  loop: EditorLoop,
  preRollSeconds = 4,
  postRollSeconds = 4,
): PreviewExcerpt {
  const { startSample, endSample, sampleRate } = loop
  const pre = Math.min(Math.round(preRollSeconds * sampleRate), endSample - startSample)
  const post = Math.min(Math.round(postRollSeconds * sampleRate), endSample - startSample)
  const fade = Math.min(Math.round((loop.crossfadeMs / 1000) * sampleRate), startSample, Math.floor(pre / 2))
  const ramp = Math.min(Math.round(EDGE_RAMP_SECONDS * sampleRate), Math.floor(post / 2))
  const out = channels.map((channel) => {
    const excerpt = new Float32Array(pre + post)
    excerpt.set(channel.subarray(endSample - pre, endSample), 0)
    excerpt.set(channel.subarray(startSample, startSample + post), pre)
    for (let i = 0; i < fade; i++) {
      const t = ((i + 1) / fade) * (Math.PI / 2)
      const at = pre - fade + i
      excerpt[at] = excerpt[at]! * Math.cos(t) + (channel[startSample - fade + i] ?? 0) * Math.sin(t)
    }
    for (let i = 0; i < ramp; i++) {
      const gain = i / ramp
      excerpt[excerpt.length - 1 - i]! *= gain
      excerpt[i]! *= gain
    }
    return excerpt
  })
  return { channels: out, seamIndex: pre }
}

export interface LoopPreview {
  stop(): void
}

export interface PreviewOptions {
  volume?: number
  preRollSeconds?: number
  postRollSeconds?: number
  onEnded?: () => void
}

export function startLoopPreview(
  context: AudioContext,
  source: { numberOfChannels: number; getChannelData(channel: number): Float32Array },
  loop: EditorLoop,
  options: PreviewOptions = {},
): LoopPreview {
  const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c))
  const excerpt = buildPreviewExcerpt(channels, loop, options.preRollSeconds, options.postRollSeconds)
  const length = excerpt.channels[0]?.length ?? 0
  const buffer = context.createBuffer(excerpt.channels.length, Math.max(1, length), loop.sampleRate)
  excerpt.channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c))
  const node = context.createBufferSource()
  const gain = context.createGain()
  gain.gain.value = options.volume ?? 0.8
  node.buffer = buffer
  node.loop = true
  node.connect(gain)
  gain.connect(context.destination)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    node.onended = null
    try {
      node.stop()
    } catch {
      // already stopped
    }
    node.disconnect()
    gain.disconnect()
    options.onEnded?.()
  }
  node.start()
  return { stop }
}
