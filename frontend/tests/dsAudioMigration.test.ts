import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createOriginalTrackResolver, validateSoundtrackManifest, type SoundtrackManifest } from '../src/music/soundtrack.ts'

const root = new URL('../public/assets/music/', import.meta.url)
const manifest: SoundtrackManifest = JSON.parse(readFileSync(new URL('soundtrack.json', root), 'utf8'))
interface AuditTrack {
  action: 'KEEP' | 'REPLACE' | 'REVIEW'
  before: SoundtrackManifest['tracks'][string]
  beforeSha256: string
  replacement?: string
  replacementSha256?: string
  source?: string
  sourceSha256?: string
  auditioned?: boolean
}
const audit: { tracks: Record<string, AuditTrack>; profilesBefore: SoundtrackManifest['profiles'] } = JSON.parse(
  readFileSync(new URL('../../scripts/data/ds_audio_migration.json', import.meta.url), 'utf8'),
)
const analysis = JSON.parse(readFileSync(new URL('../../scripts/data/ds_loop_analysis.json', import.meta.url), 'utf8'))
// Structural pass (docs/MUSIC.md, 2026-10-26): re-measured the DS replacements and the Maya default theme.
const analysisV2 = JSON.parse(readFileSync(new URL('../../scripts/data/ds_loop_analysis_v2.json', import.meta.url), 'utf8'))
const STRUCTURAL = 'structural-lag-run+seam-v2'
// The only pre-expansion entry whose LOOP was deliberately re-curated (requested: the old loop returned too early).
const RECURATED_LOOP = new Set(['maya_fey_turnabout_sisters_2001'])
const digest = (src: string) => createHash('sha256').update(readFileSync(new URL(src, root))).digest('hex')
// Copyrighted OST files are local-only. Entirely absent game groups are allowed;
// a partially installed group is an error, including missing DS derivatives.
const installedDiscs = new Set(Object.values(manifest.tracks)
  .filter(entry => entry.src && existsSync(new URL(entry.src, root)))
  .map(entry => entry.disc ?? 1))
const installed = (entry: SoundtrackManifest['tracks'][string]) => installedDiscs.has(entry.disc ?? 1)

test('local OST groups may be wholly absent but cannot be partially installed', () => {
  for (const [id, entry] of Object.entries(manifest.tracks)) {
    if (entry.src && installed(entry)) assert.ok(existsSync(new URL(entry.src, root)), `${id}: partial installation`)
  }
})

test('DS migration preserves all 25 older and four REVIEW audio files and complete entries', () => {
  const counts = { KEEP: 0, REPLACE: 0, REVIEW: 0 }
  for (const [id, record] of Object.entries(audit.tracks)) {
    counts[record.action]++
    if (record.action === 'REPLACE') continue
    if (RECURATED_LOOP.has(id)) {
      const { loop: _after, ...after } = manifest.tracks[id] as Record<string, unknown>
      const { loop: _before, ...before } = record.before as Record<string, unknown>
      assert.deepEqual(after, before, `${id}: everything except the re-curated loop preserved`)
      assert.equal((manifest.tracks[id].loop as Record<string, unknown>).method, STRUCTURAL)
    } else {
      assert.deepEqual(manifest.tracks[id], record.before, `${id}: entire metadata/loop/gain preserved`)
    }
    if (installed(record.before)) assert.equal(digest(record.before.src!), record.beforeSha256, `${id}: bytes preserved`)
  }
  assert.deepEqual(counts, { KEEP: 25, REPLACE: 55, REVIEW: 4 })
  assert.deepEqual(manifest.profiles, audit.profilesBefore)
})

test('55 DS replacements retain logical identity and audited files, with structural measured loops or an explained whole-file fallback', () => {
  assert.deepEqual(validateSoundtrackManifest(manifest), [])
  const replaced = Object.entries(audit.tracks).filter(([, record]) => record.action === 'REPLACE')
  assert.deepEqual(Object.keys(analysis).sort(), replaced.map(([id]) => id).sort())
  const paths = new Set<string>()
  let measured = 0, whole = 0, flac = 0, mp3 = 0
  for (const [id, record] of replaced) {
    const entry = manifest.tracks[id]
    assert.ok(entry, `${id}: ID survives`)
    for (const field of ['number', 'disc', 'game', 'title', 'category', 'contextual', 'tags'] as const) {
      assert.deepEqual(entry[field], record.before[field], `${id}: ${field} unchanged`)
    }
    assert.equal(entry.src, record.replacement)
    assert.notEqual(entry.src, record.before.src, `${id}: remaster no longer referenced`)
    assert.match(entry.src!, /^original\/ds-[a-z0-9-]+\.(mp3|flac)$/)
    assert.ok(!paths.has(entry.src!)); paths.add(entry.src!)
    if (installed(entry)) assert.equal(digest(entry.src!), record.replacementSha256)
    assert.ok(record.source && !/^(?:[A-Za-z]:|\/)/.test(record.source), 'source provenance is relative')
    assert.equal(record.auditioned, false)
    assert.equal(entry.gain, 1, 'no reused remaster normalization')
    assert.equal(entry.loudnessLufs, undefined)
    if (entry.src!.endsWith('.flac')) {
      flac++
      if (installed(entry)) {
        const bytes = readFileSync(new URL(entry.src!, root))
        assert.equal(bytes.subarray(0, 4).toString(), 'fLaC')
        assert.equal((bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4), 32728, 'native NCSF123 rate retained')
      }
    } else {
      mp3++
      assert.equal(record.replacementSha256, record.sourceSha256, 'original DS MP3 copied byte-for-byte')
    }
    const result = analysis[id]
    const v2 = analysisV2[id]
    assert.ok(v2, `${id}: structural analysis recorded`)
    const loop = entry.loop as Record<string, unknown> | null
    if (loop) {
      measured++
      assert.equal(entry.loopStatus, 'measured_not_auditioned')
      assert.equal(loop.status, 'measured_not_auditioned')
      assert.equal(loop.sampleRate, 44100)
      assert.notDeepEqual(entry.loop, record.before.loop, 'remaster loop not reused')
      if (loop.method === STRUCTURAL) {
        assert.equal(loop.startSample, v2.best.start)
        assert.equal(loop.endSample, v2.best.end)
        assert.ok(v2.best.credible && v2.best.postSeamNcc >= 0.85 && v2.best.clickRatio <= 3)
        assert.ok(v2.best.end / 44100 <= v2.duration)
      } else {
        // an earlier strict-envelope loop kept because the structural pass found the same period and phase
        assert.equal(v2.keptPrevious, true, `${id}: only an equivalent v1 loop may stay`)
        assert.equal(loop.startSample, result.best.start)
        assert.equal(loop.endSample, result.best.end)
        assert.ok(result.best.passes && result.best.coverage >= 0.70 && result.best.envelope >= 0.92 && result.best.seam >= 0.95)
      }
    } else {
      whole++
      assert.equal(entry.loopStatus, 'whole_file')
      assert.equal(v2.best, null)
      assert.equal(entry.loopReason, v2.reason)
    }
  }
  assert.deepEqual({ measured, whole, flac, mp3 }, { measured: 51, whole: 4, flac: 27, mp3: 28 })
})

test('character theme IDs still resolve through the existing MusicEngine track resolver', async () => {
  const resolve = createOriginalTrackResolver(manifest, '/assets/music/')
  for (const character of ['miles_edgeworth', 'franziska_von_karma', 'larry_butz', 'pearl_fey']) {
    const id = audit.profilesBefore[character].defaultTrack
    const track = await resolve.resolve(id)
    assert.equal(track?.id, id)
    assert.equal(track?.url, `/assets/music/${manifest.tracks[id].src}`)
    assert.match(track!.url, /\/original\/ds-/)
  }
})
