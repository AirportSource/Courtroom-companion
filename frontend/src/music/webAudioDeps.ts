// Production wiring for the Web Audio sources: the shared AudioContext from audioEngine
// (D-019) and one decoded-buffer cache shared by the original and imported sources.
import { audioEngine } from '../engine/audioEngine.ts'
import { createBufferCache } from './bufferCache.ts'
import { decodedTrackBytes, type DecodedTrack, type WebAudioDeps } from './webAudioSource.ts'

export function createDefaultWebAudioDeps(): WebAudioDeps {
  return {
    getContext: () => audioEngine.getContext(),
    unlock: () => audioEngine.unlock(),
    cache: createBufferCache<DecodedTrack>(decodedTrackBytes),
  }
}
