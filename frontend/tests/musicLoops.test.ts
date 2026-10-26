// Regression tests for the structural loop pass (docs/MUSIC.md, "2026-10-26 structural loop pass").
// Everything here is deterministic metadata checking: no audio is decoded and nothing is "listened" to.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseLoopMetadata, validateLoopRegion } from '../src/music/loopMath.ts'
import type { SoundtrackManifest } from '../src/music/soundtrack.ts'

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const manifest: SoundtrackManifest = read('../public/assets/music/soundtrack.json')
const v2: Record<string, any> = read('../../scripts/data/ds_loop_analysis_v2.json')
// Track ids and audio paths as they were before the structural pass (the pass may only touch loop fields).
const idSrcSnapshot: Record<string, string | null> = read('./fixtures/soundtrack-ids-src.json')
const audit: { tracks: Record<string, { action: string }> } = read('../../scripts/data/ds_audio_migration.json')

const STRUCTURAL = 'structural-lag-run+seam-v2'
const SR = 44100
const entries = Object.entries(manifest.tracks)
const structural = entries.filter(([, t]) => t.loop && (t.loop as Record<string, unknown>).method === STRUCTURAL)

test('track ids and audio sources are unchanged by the loop pass (snapshot of ids + src)', () => {
  assert.deepEqual(Object.keys(manifest.tracks), Object.keys(idSrcSnapshot))
  for (const [id, track] of entries) assert.equal(track.src ?? null, idSrcSnapshot[id] ?? null, `${id}: src changed`)
})

test('every loop is a valid region inside the audio, with integer samples', () => {
  for (const [id, track] of entries) {
    if (!track.loop) continue
    const meta = parseLoopMetadata(track.loop)
    assert.ok(meta.region, `${id}: parses`)
    const duration = v2[id]?.duration
    const verdict = validateLoopRegion(meta.region, duration ? Math.floor(duration * meta.region.sampleRate) : undefined)
    assert.deepEqual(verdict, { ok: true }, `${id}: start < end <= duration`)
    assert.ok(meta.region.startSample >= 0 && meta.region.startSample < meta.region.endSample)
  }
})

test('structural loops: measured_not_auditioned, never claimed as heard or as DS loop points, long enough', () => {
  assert.ok(structural.length >= 50, `expected the structural loops, got ${structural.length}`)
  for (const [id, track] of structural) {
    const loop = track.loop as Record<string, unknown>
    assert.equal(loop.status, 'measured_not_auditioned', `${id}: status`)
    assert.equal(loop.provenance, 'curated-analysis', `${id}: provenance`)
    assert.equal(loop.sampleRate, SR, `${id}: analysis sample rate`)
    assert.match(String(loop.note), /Not an original DS loop point; not verified by listening/, `${id}: honest note`)
    if ('loopStatus' in track) assert.equal((track as Record<string, unknown>).loopStatus, 'measured_not_auditioned', `${id}: loopStatus`)
    const info = v2[id]
    assert.ok(info?.best, `${id}: evidence recorded in ds_loop_analysis_v2.json`)
    assert.equal(info.best.start, loop.startSample, `${id}: evidence start`)
    assert.equal(info.best.end, loop.endSample, `${id}: evidence end`)
    const seconds = ((loop.endSample as number) - (loop.startSample as number)) / SR
    const minimum = info.short ? 12 : Math.min(0.4 * info.duration, 30)
    assert.ok(seconds >= minimum, `${id}: loop ${seconds.toFixed(1)} s shorter than ${minimum.toFixed(1)} s`)
    assert.ok(info.best.postSeamNcc >= 0.85 && info.best.clickRatio <= 3, `${id}: seam metrics recorded as acceptable`)
    const confidence = loop.confidence as number
    assert.ok(confidence > 0 && confidence <= 0.95, `${id}: confidence is an honest estimate, never certainty`)
  }
})

test('whole-file fallbacks (playable tracks without a loop) all carry a stated reason', () => {
  // Structural-pass wording, plus the D-044 wording kept verbatim on the untouched pre-expansion / REVIEW entries.
  const reason = /(non-looping|jingle|insufficient repeated material|uncertain seam|needs human audition|two-part|best candidate .* fails|no repeating section)/i
  let whole = 0
  for (const [id, track] of entries) {
    if (!track.src || track.category === 'excluded' || track.loop) continue
    whole++
    assert.ok(track.loopReason && reason.test(track.loopReason), `${id}: missing or vague loopReason`)
  }
  assert.ok(whole >= 4)
  // The DS replacements that stay whole-file say so and match their recorded evidence.
  for (const [id, record] of Object.entries(audit.tracks)) {
    if (record.action !== 'REPLACE' || manifest.tracks[id].loop) continue
    assert.equal(manifest.tracks[id].loopReason, v2[id].reason, `${id}: reason equals the structural evidence`)
    assert.match(String(v2[id].reason), /Not auditioned/)
  }
})

test('Turnabout Sisters 2001 (Maya/Mia default) loops late: more of the composition plays before the first loop-back', () => {
  const id = 'maya_fey_turnabout_sisters_2001'
  const track = manifest.tracks[id]
  const loop = track.loop as Record<string, number | string>
  const info = v2[id]
  const oldLoopEnd = 5528236 // previous manifest value (51.50-125.36 s, lag-diagonal+xcorr-v1)
  assert.equal(loop.method, STRUCTURAL)
  assert.equal(loop.status, 'measured_not_auditioned')
  const start = (loop.startSample as number) / SR
  const end = (loop.endSample as number) / SR
  assert.ok(start > 73.5 && start < 74.5, `loopStart ${start}`)
  assert.ok(end > 147.4 && end < 148.2, `loopEnd ${end}`)
  assert.ok(Math.abs(end - start - 73.86) < 0.1, 'loop length equals the 73.86 s repeat period of the composition')
  assert.ok(end / info.duration >= 0.9, 'at least 90% of the track plays before the first loop-back')
  assert.ok(end > oldLoopEnd / SR + 20, 'at least 20 s more than the old loop (125.36 s)')
  assert.ok(info.previousLoop.firstLoopBackShare < 0.8, 'the old loop returned at 78%')
  // Seam quality is kept (or improved) relative to the previous loop.
  assert.ok(info.best.postSeamNcc >= info.previousLoop.postSeamNcc - 0.01)
  assert.ok(info.best.clickRatio <= info.previousLoop.clickRatio + 0.5)
  // The Maya and Mia profiles still select this track by its unchanged id.
  assert.equal(manifest.profiles.maya_fey.defaultTrack, id)
  assert.equal(manifest.profiles.mia_fey.defaultTrack, id)
})

test('only loop-related fields of the structural pass differ for pre-expansion entries (they stay evidence-only)', () => {
  for (const [id, record] of Object.entries(audit.tracks)) {
    if (record.action === 'REPLACE' || id === 'maya_fey_turnabout_sisters_2001') continue
    assert.match(String(v2[id]?.disposition ?? 'evidence only'), /evidence only/, `${id}: KEEP/REVIEW entries are not rewritten`)
  }
})
