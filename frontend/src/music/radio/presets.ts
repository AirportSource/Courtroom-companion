// Radio presets. Livestream IDs change over time, so a preset ID is configuration, never
// a constant of the engine: the UI lets the user override it (persisted by settings).

export interface RadioPreset {
  id: string
  title: string
  /** Default YouTube video ID; overridable by the user. */
  videoId: string
  /** True when checked against YouTube and matched the expected title. */
  verified: boolean
  /** False when YouTube's official IFrame player has refused this video for embedding. */
  available: boolean
  unavailableReason?: string
}

// 2026-10-24: the current candidate's official oEmbed title matches this stream. Testing it
// in the official IFrame API from the app origin returned error 150 (embedding disabled).
// Keep the generic YouTube URL/ID input available; do not work around the refusal.
export const LOFI_GIRL_PRESET: RadioPreset = {
  id: 'lofi-girl',
  title: 'lofi hip hop radio 📚 beats to relax/study to',
  videoId: 'EWrX250Zhko',
  verified: true,
  available: false,
  unavailableReason: 'YouTube error 150: embedding is disabled for this video.',
}

export const RADIO_PRESETS: readonly RadioPreset[] = [LOFI_GIRL_PRESET]
export const DEFAULT_RADIO_VIDEO_ID = LOFI_GIRL_PRESET.videoId
