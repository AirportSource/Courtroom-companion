import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { detectLanguage, LANGUAGES, localizedName, STRINGS, translate } from '../src/i18n/i18n.ts'
import { EN } from '../src/i18n/strings.ts'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('every language defines every key with the same placeholders', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.value), ['en', 'fr', 'ja', 'it', 'es'])
  for (const { value } of LANGUAGES) {
    const strings = STRINGS[value]
    assert.deepEqual(Object.keys(strings).sort(), Object.keys(EN).sort(), `${value}: key set`)
    for (const [key, text] of Object.entries(EN)) {
      const local = strings[key as keyof typeof EN]
      assert.ok(local.trim(), `${value}.${key} is empty`)
      assert.deepEqual(placeholders(local), placeholders(text), `${value}.${key} placeholders`)
    }
  }
})

test('translations are actually translated (not English copies) for player-facing text', () => {
  for (const language of ['fr', 'ja', 'it', 'es'] as const) {
    for (const key of ['title.start', 'select.character', 'settings.language', 'chat.placeholder', 'evidence.drop'] as const) {
      assert.notEqual(STRINGS[language][key], EN[key], `${language}.${key}`)
    }
  }
})

test('placeholders are filled and unknown ones are kept', () => {
  assert.equal(translate('fr', 'chat.thinking', { name: 'Mia Fey' }), 'Mia Fey réfléchit…')
  assert.equal(translate('ja', 'chat.placeholder', { name: '綾里真宵' }), '綾里真宵に話しかける…')
  assert.equal(translate('es', 'music.loading', {}), 'Cargando {title}…')
})

test('browser language detection picks the first supported base language', () => {
  assert.equal(detectLanguage(['de-DE', 'fr-CA', 'en']), 'fr')
  assert.equal(detectLanguage(['ja']), 'ja')
  assert.equal(detectLanguage(['pt-BR']), 'en')
  assert.equal(detectLanguage([]), 'en')
})

test('character packs name every character in every language', () => {
  const index = JSON.parse(readFileSync(new URL('../public/assets/characters/index.json', import.meta.url), 'utf8'))
  for (const path of Object.values(index.characters) as string[]) {
    const manifest = JSON.parse(readFileSync(new URL(`../public/assets/characters/${path}`, import.meta.url), 'utf8'))
    for (const { value } of LANGUAGES) assert.ok(manifest.names?.[value], `${manifest.id} has no ${value} name`)
    const lines = manifest.taskAcknowledgements.artifact.lines
    for (const { value } of LANGUAGES) assert.ok(lines[value]?.length, `${manifest.id} has no ${value} acknowledgement`)
  }
  assert.equal(localizedName({ displayName: 'Dick Gumshoe', names: { fr: 'Dick Tektiv', ja: '糸鋸圭介' } }, 'fr'), 'Dick Tektiv')
  assert.equal(localizedName({ displayName: 'Dick Gumshoe', names: { fr: 'Dick Tektiv' } }, 'es'), 'Dick Gumshoe')
})
