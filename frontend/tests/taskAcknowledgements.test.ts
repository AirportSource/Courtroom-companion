import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readTaskAcknowledgements, taskAcknowledgement } from '../src/engine/taskAcknowledgements.ts'

const pack = JSON.parse(readFileSync(new URL('../public/assets/characters/maya/character.json', import.meta.url), 'utf8'))
const character = { taskAcknowledgements: readTaskAcknowledgements(pack.taskAcknowledgements, pack.emotions, pack.defaultEmotion) }
test('local acknowledgement copy and pose come from the character pack, with rotating locale variants', () => {
  const variants = Array.from({ length: 4 }, (_, n) => taskAcknowledgement(character, 'artifact', 'en', n)!)
  assert.equal(new Set(variants.map((v) => v.text)).size, 4)
  for (const v of variants) { assert.ok(pack.taskAcknowledgements.artifact.lines.en.includes(v.text)); assert.equal(v.sfx, null) }
  assert.equal(taskAcknowledgement(character, 'artifact', 'fr-CA', 0)?.text, pack.taskAcknowledgements.artifact.lines.fr[0])
  assert.equal(taskAcknowledgement(character, 'artifact', 'ja', 1)?.text, pack.taskAcknowledgements.artifact.lines.ja[1])
  assert.equal(taskAcknowledgement(character, 'artifact', 'zz', 0)?.text, variants[0].text)
  assert.equal(taskAcknowledgement({}, 'artifact', 'en', 0), null)
  const other = { taskAcknowledgements: readTaskAcknowledgements({ artifact: { emotion: 'calm', lines: { en: ['Understood.'] } } }, { calm: {} }, 'calm') }
  assert.equal(taskAcknowledgement(other, 'artifact', 'en', 0)?.text, 'Understood.')
})

test('malformed optional task copy is ignored and invalid emotions fall back safely', () => {
  assert.deepEqual(readTaskAcknowledgements(null, {}, 'neutral'), {})
  const parsed = readTaskAcknowledgements({ artifact: { emotion: 'invalid', lines: { en: ['', 42, 'Good.'], xx: null } } }, { neutral: {} }, 'neutral')
  assert.deepEqual(parsed.artifact, { emotion: 'neutral', lines: { en: ['Good.'] } })
})
