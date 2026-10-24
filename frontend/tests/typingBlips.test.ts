import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTypingBlipper, isCommittedBlip, isTypedBlip, TYPING_BLIP_MIN_GAP_MS } from '../src/engine/typingBlips.ts'

const typed = (data: string | null, inputType = 'insertText', isComposing = false) => ({ inputType, data, isComposing })
const on = { volume: 0.5, muted: false }

test('only typed visible characters blip', () => {
  assert.equal(isTypedBlip(typed('a')), true)
  assert.equal(isTypedBlip(typed('7')), true)
  assert.equal(isTypedBlip(typed('é')), true)
  for (const quiet of [' ', '.', '!', '?', ',', '-', '"']) assert.equal(isTypedBlip(typed(quiet)), false, quiet)
  // Deletions, paste and line breaks; Shift/Ctrl/arrows/F-keys never produce input events at all.
  for (const inputType of ['deleteContentBackward', 'deleteContentForward', 'insertFromPaste', 'insertLineBreak', 'historyUndo']) {
    assert.equal(isTypedBlip(typed('a', inputType)), false, inputType)
  }
  assert.equal(isTypedBlip(typed(null)), false)
  assert.equal(isTypedBlip(typed('')), false)
})

test('no blips while an IME composition is in progress; one at commit', () => {
  assert.equal(isTypedBlip(typed('に', 'insertCompositionText', true)), false)
  assert.equal(isTypedBlip(typed('k', 'insertText', true)), false)
  assert.equal(isCommittedBlip('日本'), true)
  assert.equal(isCommittedBlip('　'), false)
  assert.equal(isCommittedBlip(''), false)
  assert.equal(isCommittedBlip(null), false)
})

test('blipper throttles, never overlaps, and respects mute/volume', () => {
  let time = 1000
  const plays: number[] = []
  const blipper = createTypingBlipper((v) => plays.push(v), () => time)
  assert.equal(blipper.onInput(typed('a'), on), true)
  time += TYPING_BLIP_MIN_GAP_MS - 1
  assert.equal(blipper.onInput(typed('b'), on), false, 'too soon')
  time += 1
  assert.equal(blipper.onInput(typed('c'), on), true)
  time += 500
  assert.equal(blipper.onInput(typed('d'), { volume: 0.5, muted: true }), false)
  assert.equal(blipper.onInput(typed('d'), { volume: 0, muted: false }), false)
  assert.equal(blipper.onInput(typed(' '), on), false)
  assert.equal(blipper.onCompositionEnd('字', on), true)
  assert.deepEqual(plays, [0.5, 0.5, 0.5])
  assert.ok(TYPING_BLIP_MIN_GAP_MS >= 60)
})
