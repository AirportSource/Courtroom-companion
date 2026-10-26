import assert from 'node:assert/strict'
import { test } from 'node:test'
import kuromoji from 'kuromoji'
import { createRequire } from 'node:module'
import { dirname,join } from 'node:path'
import { alignReadings,analysisText } from '../src/reading/japaneseReading.ts'
import names from '../src/data/japaneseProperNames.json' with {type:'json'}

test('proper-name data has unique forms, hiragana readings and recorded verification sources',()=>{
  const seen=new Set<string>()
  for(const name of names.entries){
    assert.match(name.reading,/^[\p{Script=Hiragana}ー]+$/u)
    assert.ok(names.sources[name.source as keyof typeof names.sources])
    for(const form of [name.surface,...(name.alternativeForms??[])]){assert.ok(!seen.has(form));seen.add(form)}
  }
})
test('real Kuromoji spans are overridden with longest complete names, leaving titles/honorifics intact',async()=>{
  const dict=join(dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')),'dict')
  const tokenizer=await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve,reject)=>kuromoji.builder({dicPath:dict}).build((error,t)=>error?reject(error):resolve(t)))
  for(const [text,surface,reading] of [['成歩堂','成歩堂','なるほどう'],['成歩堂龍一','成歩堂龍一','なるほどうりゅういち'],
    ['成歩堂さん','成歩堂','なるほどう'],['御剣検事','御剣','みつるぎ'],['綾里真宵','綾里真宵','あやさとまよい'],
    ['Case: 「成歩\n堂龍一さん」','成歩堂龍一','なるほどうりゅういち'],['👩🏽‍⚖️ 成歩堂 龍一','成歩堂 龍一','なるほどうりゅういち']]){
    const words=alignReadings(text,tokenizer.tokenize(analysisText(text).text))
    const name=words.find(w=>w.properName)
    assert.equal(name?.surface,surface,text);assert.equal(name?.reading,reading,text)
    assert.equal(words.filter(w=>w.properName).length,1)
    if(text==='御剣検事')assert.equal(words.find(w=>w.surface==='検事')?.reading,'けんじ')
  }
  for(const text of ['新成歩堂研究所','御剣術','あやめの花','ABC成歩堂X']){
    assert.equal(alignReadings(text,tokenizer.tokenize(text)).some(w=>w.properName),false,text)
  }
  for(const entry of names.entries){
    const words=alignReadings(entry.surface,tokenizer.tokenize(entry.surface))
    assert.equal(words.find(w=>w.properName)?.reading,entry.reading,entry.surface)
  }
})
