import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generationDiagnosticLine, generationFailureMessage, parseGeneration } from '../src/engine/generation.ts'
import { parseChatResponse } from '../src/engine/performance.ts'

test('output budget and context exhaustion have distinct actionable UI diagnostics', () => {
  const generation = parseGeneration({ workload: 'text_artifact', maxOutputTokens: 16384, stopReason: 'max_tokens' })!
  const limited = generationFailureMessage('output_token_limit', generation)!
  const context = generationFailureMessage('context_window_exceeded', { ...generation, stopReason: 'model_context_window_exceeded' })!
  assert.match(limited, /16384 tokens/)
  assert.match(limited, /before finishing the file/)
  assert.match(limited, /No partial file was saved/)
  assert.doesNotMatch(limited, /context/)
  assert.match(context, /context window/)
  assert.match(context, /too large for this model's context window/)
  assert.match(context, /Shorten the conversation/)
  assert.match(context, /increasing the output budget alone will not fix/)
  assert.match(generationFailureMessage('provider_refused', generation)!, /declined/)
  assert.equal(generationFailureMessage(null, generation), null)
  assert.doesNotMatch(generationFailureMessage('output_token_limit', { workload: 'dialogue', maxOutputTokens: 600 })!, /partial file/)
  assert.match(generationFailureMessage('output_token_limit', { workload: 'dialogue', maxOutputTokens: 4096 })!, /before finishing the reply/)
})

test('generation diagnostics accept only bounded safe metadata and remain separate from performance', () => {
  assert.equal(parseGeneration({ workload: 'text_artifact', maxOutputTokens: 1000000 }), null)
  assert.equal(parseGeneration({ workload: 'shell', maxOutputTokens: 16384 }), null)
  const diagnostic = parseGeneration({ workload: 'dialogue', maxOutputTokens: 600, stopReason: 'secret-untrusted-value', thinking: 'hidden', apiKey: 'secret' })!
  assert.deepEqual(diagnostic, { workload: 'dialogue', maxOutputTokens: 600 })
  const response = parseChatResponse({ generation: diagnostic,
    performance: { segments: [{ text: 'Hello!', emotion: 'happy', animation: 'smile_front' }] } })
  assert.deepEqual(response.generation, diagnostic)
  assert.equal(response.performance.segments[0].text, 'Hello!')
  assert.ok(!JSON.stringify(response.performance).includes('maxOutputTokens'))
})

test('artifact size, provider limits and failure classes have distinct messages and bounded diagnostics', () => {
  assert.match(generationFailureMessage('artifact_too_large')!, /64 KiB/)
  assert.match(generationFailureMessage('provider_limit')!, /quota or request-size/)
  assert.equal(generationFailureMessage('rate_limited'), generationFailureMessage('provider_limit'))
  assert.equal(generationFailureMessage('unknown'), null)
  const diagnostics = parseGeneration({ workload: 'dialogue', maxOutputTokens: 4096, stopReason: 'max_tokens', failureClass: 'output_truncated' })!
  assert.equal(diagnostics.failureClass, 'output_truncated')
  assert.equal(parseGeneration({ workload: 'dialogue', maxOutputTokens: 4096, failureClass: 'anything' })!.failureClass, undefined)
  assert.equal(generationDiagnosticLine('output_token_limit', diagnostics), 'generation: dialogue · budget 4096 · stop max_tokens · class output_truncated · code output_token_limit')
  assert.equal(generationDiagnosticLine('x'), null)
})
