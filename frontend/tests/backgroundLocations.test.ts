import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../public/assets/backgrounds/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('backgrounds.json', root), 'utf8'))

const additions = {
  bg_50: 'background_50_256x192.png',
  bg_51: 'background_51_256x192.png',
  bg_52: 'background_52_256x192.png',
} as const

test('the three imported locations are selectable native-size PNG backgrounds', () => {
  for (const [id, src] of Object.entries(additions)) {
    const entry = manifest.backgrounds[id]
    assert.ok(entry, `${id}: missing registry entry`)
    assert.equal(entry.src, src)
    assert.equal(entry.width, 256)
    assert.equal(entry.height, 192)
    assert.deepEqual(Object.keys(entry.names).sort(), ['en', 'es', 'fr', 'it', 'ja'])
    for (const [language, name] of Object.entries(entry.names)) {
      assert.ok(typeof name === 'string' && name.trim(), `${id}: blank ${language} label`)
    }

    const png = readFileSync(new URL(src, root))
    assert.equal(png.toString('ascii', 1, 4), 'PNG')
    assert.equal(png.readUInt32BE(16), 256)
    assert.equal(png.readUInt32BE(20), 192)
  }
})

test('existing locations remain registered', () => {
  for (let number = 1; number <= 49; number += 1) {
    assert.ok(manifest.backgrounds[`bg_${String(number).padStart(2, '0')}`])
  }
})
