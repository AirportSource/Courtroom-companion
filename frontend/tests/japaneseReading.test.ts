import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import kuromoji from 'kuromoji'
import { alignReadings, analysisText, createReadingAnalyzer, popupPosition, readingEnabled, toHiragana } from '../src/reading/japaneseReading.ts'
import { DEFAULT_SETTINGS, readStoredSettings, writeStoredSettings, completeProviderMigration } from '../src/settings/settings.ts'
import { DICTIONARY_FILES, kuromojiAssets } from '../scripts/kuromojiAssets.ts'

test('katakana readings become hiragana without dropping small/voiced kana or sound marks', () => {
  for (const [input, output] of [['ショウコ','しょうこ'],['シラベル','しらべる'],['キョウ','きょう'],
    ['ヴァイオリン・スーパー','ゔぁいおりん・すーぱー'],['もうABC！？','もうABC！？']]) assert.equal(toHiragana(input),output)
})

test('assistant is opt-in and Japanese-only, even when English contains kanji', () => {
  assert.equal(DEFAULT_SETTINGS.japaneseReadingAssistant,false)
  for (const language of ['en','fr','it','es']) assert.equal(readingEnabled(true,language),false)
  assert.equal(readingEnabled(false,'ja'),false)
  assert.equal(readingEnabled(true,'ja-JP'),true)
})

test('reading preference survives save/restart and provider migration, rejecting malformed settings', () => {
  let stored = '{}'
  const original = Object.getOwnPropertyDescriptor(globalThis,'window')
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:()=>stored,setItem:(_key:string,value:string)=>{stored=value}}}})
  try {
    assert.equal(readStoredSettings().japaneseReadingAssistant,false)
    stored = '{"japaneseReadingAssistant":"true"}'
    assert.equal(readStoredSettings().japaneseReadingAssistant,false)
    writeStoredSettings({...DEFAULT_SETTINGS,japaneseReadingAssistant:true,japaneseDefinitionLanguage:'en'})
    assert.equal(readStoredSettings().japaneseReadingAssistant,true)
    assert.equal(readStoredSettings().japaneseDefinitionLanguage,'en')
    completeProviderMigration()
    assert.equal(readStoredSettings().japaneseReadingAssistant,true)
    assert.equal(readStoredSettings().japaneseDefinitionLanguage,'en')
    writeStoredSettings({...DEFAULT_SETTINGS,japaneseReadingAssistant:false})
    assert.equal(readStoredSettings().japaneseReadingAssistant,false)
  } finally { if(original) Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window') }
})

test('simultaneous analysis initializes once, caches page results, and keeps failures recoverable', async () => {
  let loads=0, calls=0
  const analyze=createReadingAnalyzer(async()=>{loads++;return {tokenize:()=>{calls++;return []}}})
  await Promise.all([analyze('証拠'),analyze('今日'),analyze('証拠')])
  assert.equal(loads,1);assert.equal(calls,2)
  let attempts=0
  const failing=createReadingAnalyzer(async()=>{attempts++;throw Error('offline file missing')})
  await assert.rejects(failing('証拠'))
  await assert.rejects(failing('証拠'))
  assert.equal(attempts,2)
})

test('popup placement stays within logical stage bounds independently of CSS scale', () => {
  for (const scale of [1,2,3,4,5.5]) for (const word of [{left:0,top:0,bottom:16},{left:240,top:174,bottom:190},{left:120,top:100,bottom:116}]) {
    const pos=popupPosition(word,144,80)
    assert.ok(pos.left>=0 && pos.left+144<=256)
    assert.ok(pos.top>=0 && pos.top+80<=192)
    assert.equal(pos.left,Math.round(pos.left));assert.equal(pos.top,Math.round(pos.top))
    assert.ok((pos.top+80)*scale<=192*scale)
  }
})

test('Vite emits exactly the installed dictionary and required notices', () => {
  const emitted: {fileName:string;source:Buffer}[]=[]
  const plugin=kuromojiAssets()
  const hook=plugin.generateBundle as Function
  hook.call({emitFile:(file:{fileName:string;source:Buffer})=>emitted.push(file)})
  assert.equal(emitted.length,14)
  for (const name of DICTIONARY_FILES) {
    const file=emitted.find(f=>f.fileName===`assets/kuromoji/${name}`)!
    assert.ok(file.source.length>0)
    assert.equal(file.source[0],0x1f);assert.equal(file.source[1],0x8b)
  }
  assert.ok(emitted.find(f=>f.fileName.endsWith('NOTICE.md'))!.source.includes('Nara Institute'))
})

test('Vite serves raw gzip at a configured base without exposing other node_modules files', () => {
  const plugin=kuromojiAssets()
  ;(plugin.configResolved as Function)({base:'/nested/',root:process.cwd(),build:{outDir:'dist'}})
  let handler: Function
  ;(plugin.configureServer as Function)({middlewares:{use:(fn:Function)=>{handler=fn}}})
  const headers: Record<string,string>={}
  let body: Buffer | undefined, next=false
  const response={statusCode:200,setHeader:(key:string,value:string)=>{headers[key]=value},end:(value?:Buffer)=>{body=value}}
  handler!({url:'/nested/assets/kuromoji/base.dat.gz'},response,()=>{next=true})
  assert.equal(next,false);assert.equal(headers['Content-Encoding'],undefined)
  assert.equal(body![0],0x1f);assert.equal(body![1],0x8b)
  handler!({url:'/nested/assets/kuromoji/package.json'},response,()=>{})
  assert.equal(response.statusCode,404)
  handler!({url:'/nested/assets/kuromoji/../../package.json'},response,()=>{next=true})
  assert.equal(next,true)
})

test('real installed Kuromoji dictionary: contextual readings, alignment, punctuation and unknowns', async () => {
  const root=dirname(createRequire(import.meta.url).resolve('kuromoji/package.json'))
  const tokenizer=await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve,reject)=>
    kuromoji.builder({dicPath:join(root,'dict')}).build((error,tokenizer)=>error?reject(error):resolve(tokenizer)))
  const samples=['この証拠を調べてください。','今日は裁判があります。','このCourt Recordを確認してください。','「異議あり！」',
    '👩🏽‍⚖️𠮷、この証\n拠を調べました。','御剣検事は事件を調査しています。']
  for (const page of samples) {
    const words=alignReadings(page,tokenizer.tokenize(analysisText(page).text))
    let cursor=0,reconstructed=''
    for(const word of words){reconstructed+=page.slice(cursor,word.start)+page.slice(word.start,word.end);cursor=word.end;assert.ok(word.reading)}
    reconstructed+=page.slice(cursor)
    assert.equal(reconstructed,page)
    if(page.includes('今日')) assert.equal(words.find(w=>w.surface==='今日')?.reading,'きょう')
    if(page.includes('証拠')) assert.equal(words.find(w=>w.surface==='証拠')?.reading,'しょうこ')
    if(page.includes('証\n拠')) {
      const word=words.find(w=>w.surface==='証拠')!
      assert.equal(word.reading,'しょうこ')
      assert.equal(page.slice(word.start,word.end),'証\n拠')
    }
    if(page.includes('調べました')) assert.equal(words.find(w=>w.surface==='調べました')?.reading,'しらべました')
    for(const word of words) assert.match(word.surface,/\p{Script=Han}/u)
  }
  const missing={...tokenizer.tokenize('証拠')[0],reading:undefined}
  assert.deepEqual(alignReadings('証拠',[missing]),[])
  assert.deepEqual(alignReadings('証拠',[{...missing,reading:'ショウコ',word_type:'UNKNOWN'}]),[])
  assert.throws(()=>alignReadings('証拠',[{...missing,surface_form:'別の文字'}]),/alignment/)
  assert.ok(readFileSync(join(root,'NOTICE.md'),'utf8').includes('mecab-ipadic'))
})
