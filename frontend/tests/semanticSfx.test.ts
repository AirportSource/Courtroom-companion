import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { playSemanticSfx, readSemanticSounds, registerSemanticSounds, resolveSfx, SFX_NAMES } from '../src/engine/sfx.ts'

const root = new URL('../public/assets/', import.meta.url)
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const audio = json('audio/audio.json')
const known = new Set(Object.keys(audio.sounds))
const pearl = json('characters/pearl/character.json').semanticSounds
const maya = json('characters/maya/character.json').semanticSounds

function recorder() {
  const played: string[] = []
  return { played, play: (id: string) => { played.push(id); return true }, playEvent: (id: string) => { played.push(`event:${id}`); return true } }
}

test('shared and character pools only name real sounds and known semantic names', () => {
  for (const pools of [audio.semanticSounds, pearl, maya]) {
    for (const [name, ids] of Object.entries(pools as Record<string, string[]>)) {
      assert.ok((SFX_NAMES as readonly string[]).includes(name), name)
      for (const id of ids) {
        assert.ok(known.has(id), `${id} is defined in audio.json`)
        assert.ok(existsSync(new URL(`audio/${audio.sounds[id].src}`, root)), `${id} file exists`)
      }
    }
  }
  assert.deepEqual(readSemanticSounds({ angry: ['fx_smack', 'nope'], bogus: ['fx_smack'], comic: [] }, known), { angry: ['fx_smack'] })
})

test('everyone: a shared sound resolves for any character, and the global event stays the fallback', () => {
  registerSemanticSounds(audio.semanticSounds, known)
  const edgeworth = resolveSfx('angry', 'miles_edgeworth')
  assert.equal(edgeworth.source, 'shared')
  assert.ok(audio.semanticSounds.angry.includes(edgeworth.final?.id))
  const surprise = resolveSfx('surprise', 'miles_edgeworth')
  assert.equal(surprise.source, 'global')
  assert.deepEqual(surprise.final, { kind: 'event', id: 'sfx_surprise' })
  assert.equal(resolveSfx('explosion', 'x').final, null)
})

test('a character-specific candidate wins over the shared pool', () => {
  registerSemanticSounds(audio.semanticSounds, known)
  const pearlShock = resolveSfx('shock', 'pearl_fey', pearl)
  assert.equal(pearlShock.source, 'character')
  assert.equal(pearlShock.final?.id, 'fx_shock2')
  assert.ok(pearlShock.sharedCandidate, 'the shared candidate is still reported for diagnostics')
  assert.equal(resolveSfx('angry', 'pearl_fey', pearl).final?.id, 'fx_smack')
})

test('Maya and Pearl cues resolve, and a pool never repeats the same file back to back', () => {
  registerSemanticSounds(audio.semanticSounds, known)
  for (const [id, pools] of [['maya_fey', maya], ['pearl_fey', pearl]] as const) {
    const player = recorder()
    for (let i = 0; i < 4; i += 1) playSemanticSfx('comic', 1, false, id, pools, player)
    assert.deepEqual(player.played, ['sfx_cute', 'fx_comic', 'sfx_cute', 'fx_comic'])
  }
  const player = recorder()
  for (let i = 0; i < 6; i += 1) playSemanticSfx('realization', 1, false, 'larry_butz', {}, player)
  assert.deepEqual(player.played.slice(0, 3), ['fx_lightbulb', 'fx_happyping', 'sfx_realization'])
  assert.ok(player.played.every((id, i) => i === 0 || id !== player.played[i - 1]))
})

test('mute and zero volume stay silent and say why', () => {
  registerSemanticSounds(audio.semanticSounds, known)
  const player = recorder()
  assert.equal(playSemanticSfx('angry', 1, true, 'maya_fey', maya, player).reason, 'muted')
  assert.equal(playSemanticSfx('angry', 0, false, 'maya_fey', maya, player).reason, 'zero volume')
  assert.deepEqual(player.played, [])
})
