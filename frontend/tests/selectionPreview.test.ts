import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { characterPreviewPath } from '../src/engine/manifestLoader.ts'
import type { CharacterManifest } from '../src/engine/manifestTypes.ts'

const pack = (name: string): CharacterManifest => JSON.parse(readFileSync(
  new URL(`../public/assets/characters/${name}/character.json`, import.meta.url), 'utf8'))

test('Franziska menu uses its centered crop independently of the conversation frame', () => {
  const character = pack('franziska')
  assert.equal(characterPreviewPath(character), 'portraits/selection.png')
  const png = readFileSync(new URL('../public/assets/characters/franziska/portraits/selection.png', import.meta.url))
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), 'square source avoids cover cropping')
  const discussion = character.presentationGroups!.conversation
  const emotion = discussion.defaultEmotion ?? character.defaultEmotion
  const animation = (discussion.emotions ?? character.emotions)[emotion].animation
  assert.notEqual(characterPreviewPath(character), discussion.animations[animation].idle!.frames[0])
})

test('Maya retains its default idle preview and absent custom previews keep presentation fallback', () => {
  const maya = pack('maya')
  assert.equal(characterPreviewPath(maya), maya.animations[maya.emotions[maya.defaultEmotion].animation].idle!.frames[0])
  const character = pack('franziska')
  const group = character.presentationGroups!.conversation
  const emotion = group.defaultEmotion ?? character.defaultEmotion
  const expected = group.animations[(group.emotions ?? character.emotions)[emotion].animation].idle!.frames[0]
  assert.equal(characterPreviewPath({ ...character, selectionPreview: '' }), expected)
  assert.equal(characterPreviewPath({ ...character, selectionPreview: undefined }), expected)
})
