import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCourtRecordFeedback } from '../src/courtRecord/courtRecordFeedback.ts'

test('Court Record movement, confirm, back and page browsing use ordinary menu feedback only', () => {
  const events: string[] = []; let now = 0
  const feedback = createCourtRecordFeedback((event) => events.push(event), () => now)
  feedback.move(0, 0)
  feedback.move(0, 1)
  now = 200; feedback.move(5, 6)
  feedback.confirm(); feedback.back()
  assert.deepEqual(events, ['menu_cursor', 'menu_page', 'menu_confirm', 'menu_cancel'])
  assert.ok(events.every((event) => event.startsWith('menu_')))
})

test('held keys keep navigating but cursor sound is limited to a comfortable cadence', () => {
  const events: string[] = []; let now = 0
  const feedback = createCourtRecordFeedback((event) => events.push(event), () => now)
  for (let i = 0; i < 10; i++) { now = i * 30; feedback.move(i, i + 1) }
  assert.equal(events.length, 2)
  feedback.confirm(); feedback.back()
  assert.deepEqual(events.slice(-2), ['menu_confirm', 'menu_cancel'])
})
