import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../public/assets/backgrounds/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('backgrounds.json', root), 'utf8'))

test('the detention center seats characters behind its glass frame and counter (D-096)', () => {
  const room = manifest.backgrounds.bg_03
  assert.equal(room.foreground, 'background_03_foreground.png')
  assert.ok(Number.isInteger(room.characterOffsetY) && room.characterOffsetY > 0, 'characters sit lower than standing')
  const png = readFileSync(new URL(room.foreground, root))
  assert.equal(png.toString('ascii', 1, 4), 'PNG')
  assert.equal(png.readUInt32BE(16), room.width)
  assert.equal(png.readUInt32BE(20), room.height)
  assert.equal(png[25], 6, 'RGBA: the glass area must stay transparent')
})

test('other rooms keep characters in front of the plate unless they declare a foreground', () => {
  for (const [id, room] of Object.entries(manifest.backgrounds as Record<string, { foreground?: string; characterOffsetY?: number }>)) {
    if (id === 'bg_03') continue
    assert.equal(room.characterOffsetY ?? 0, room.foreground ? room.characterOffsetY ?? 0 : 0, `${id}: an offset without a foreground would just sink the character`)
  }
})
