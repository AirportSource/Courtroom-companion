import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TILE_GRID, TILE_WINDOW, tileGeometry, tileSlotOrigin } from '../src/courtRecord/evidenceTile.ts'
import { readCourtRecordPortrait } from '../src/engine/manifestLoader.ts'

test('a 70x70 frame places the 64x64 window at integer inset 3', () => {
  const geo = tileGeometry({ width: 70, height: 70 }, { width: 64, height: 64 })
  assert.deepEqual(geo.size, { width: 70, height: 70 })
  assert.deepEqual(geo.window, { left: 3, top: 3 })
  assert.deepEqual(geo.content, { left: 0, top: 0 })
  assert.equal(geo.framed, true)
})

test('odd frames and small content stay on integer coordinates', () => {
  const geo = tileGeometry({ width: 71, height: 70 }, { width: 31, height: 33 })
  assert.deepEqual(geo.window, { left: 3, top: 3 })
  assert.deepEqual(geo.content, { left: 16, top: 15 })
  for (const value of [...Object.values(geo.window), ...Object.values(geo.content)]) assert.ok(Number.isInteger(value))
})

test('a missing or too-small frame falls back to the plain 64x64 tile', () => {
  for (const frame of [null, undefined, { width: 0, height: 0 }, { width: 60, height: 60 }]) {
    const geo = tileGeometry(frame, null)
    assert.deepEqual(geo.size, { width: TILE_WINDOW, height: TILE_WINDOW })
    assert.deepEqual(geo.window, { left: 0, top: 0 })
    assert.equal(geo.framed, false)
  }
})

test('3x2 grid of 70 px tiles fits the 256x192 stage without overlap', () => {
  const origins = Array.from({ length: TILE_GRID.pageSize }, (_, slot) => tileSlotOrigin(slot))
  for (const a of origins) {
    assert.ok(a.left >= 0 && a.left + TILE_GRID.tile <= 256)
    assert.ok(a.top >= 16 && a.top + TILE_GRID.tile <= 192 - 32)
  }
  for (let i = 0; i < origins.length; i++) {
    for (let j = i + 1; j < origins.length; j++) {
      const a = origins[i], b = origins[j], t = TILE_GRID.tile
      assert.ok(a.left + t <= b.left || b.left + t <= a.left || a.top + t <= b.top || b.top + t <= a.top)
    }
  }
})

test('courtRecordPortrait resolves against the manifest URL and rejects bad shapes', () => {
  const warnings: string[] = []
  const url = 'http://localhost/assets/characters/maya/character.json'
  assert.deepEqual(readCourtRecordPortrait({ src: 'portrait.png', width: 64, height: 64 }, url, warnings),
    { url: 'http://localhost/assets/characters/maya/portrait.png', width: 64, height: 64 })
  assert.equal(readCourtRecordPortrait(undefined, url, warnings), null)
  assert.deepEqual(warnings, [])
  assert.equal(readCourtRecordPortrait({ src: 'p.png', width: 0, height: 64 }, url, warnings), null)
  assert.equal(readCourtRecordPortrait('p.png', url, warnings), null)
  assert.equal(warnings.length, 2)
})
