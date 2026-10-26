import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createDictionary, createBrowserDictionary, dictionaryShard, type DictionaryEntry } from '../src/reading/japaneseDictionary.ts'
import type { ReadingWord } from '../src/reading/japaneseReading.ts'

const root = new URL('../public/assets/jmdict/', import.meta.url)
const word = (surface: string, reading: string, base = surface, pos = '名詞'): ReadingWord => ({surface,reading,base,pos,start:0,end:surface.length,known:true})
const load = async (key: string) => JSON.parse(gunzipSync(await readFile(new URL(`${key}.json.gz.bin`,root))).toString())
const dictionary = createDictionary(load)

test('generated full dictionary: real FR/EN vocabulary, base forms and strict homograph readings', async () => {
  for (const [surface,reading,fr,en] of [['証拠','しょうこ',/preuve/i,/evidence/i],['今日','きょう',/aujourd/i,/today/i],
    ['裁判','さいばん',/procès|jugement|justice/i,/trial|judg/i],['調べる','しらべる',/examiner|vérifier|recherch|enquêt/i,/examine|investigate/i]] as const) {
    const w=word(surface,reading,surface,surface==='調べる'?'動詞':'名詞')
    const french=await dictionary({word:w,language:'fr'}), english=await dictionary({word:w,language:'en'})
    assert.equal(french?.language,'fr',surface)
    assert.match(french!.senses.flatMap(s=>s.glosses).join(';'),fr)
    assert.match(english!.senses.flatMap(s=>s.glosses).join(';'),en)
  }
  const inflected=word('調べました','しらべました','調べる','動詞')
  assert.equal((await dictionary({word:inflected,baseReading:'しらべる',language:'fr'}))?.base,'調べる')
  assert.equal(await dictionary({word:inflected,language:'fr'}),null)
  assert.equal(await dictionary({word:word('今日','こんにち'),language:'en'}).then(r=>r?.senses.some(s=>s.glosses.some(g=>/today|these days|nowadays/i.test(g)))),true)
  assert.equal(await dictionary({word:word('証拠','あいうえお'),language:'fr'}),null)
  assert.equal(await dictionary({word:word('存在しない辞書語','そんざいしない'),language:'fr'}),null)
})

test('all generated shards have pinned integrity and full coverage metadata',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'))
  assert.equal(manifest.schemaVersion,1)
  assert.ok(manifest.counts.entries>200000)
  assert.equal(manifest.counts.inputEntries,manifest.counts.entries)
  assert.ok(manifest.counts.frenchEntries>14000)
  for(const [name,info] of Object.entries(manifest.files) as [string,{bytes:number;sha256:string}][]){
    const bytes=await readFile(new URL(name,root))
    assert.equal(bytes.length,info.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256)
    const shard=JSON.parse(gunzipSync(bytes).toString())
    assert.ok(Object.keys(shard).every(key=>name.startsWith(dictionaryShard(key))))
  }
})

test('restrictions, POS, multiple senses and language fallback are enforced without guessing',async()=>{
  const entry:DictionaryEntry=['1',[['語',[],[]]],[['ご',[],false,[],[]],['かたり',[],false,[],[]]],
    [[[],['ご'],['n'],[],[],[],[],['word'],[]], [[],['かたり'],['n'],[],[],[],[],['narration'],['récit']],
      [[],['ご'],['n'],[],[],[],[],['language'],[]], [['他'],[],['n'],[],[],[],[],['unrelated'],[]]]]
  const d=createDictionary(async()=>({'語':[entry]}))
  const result=await d({word:word('語','ご'),language:'fr'})
  assert.equal(result?.language,'en')
  assert.equal(result?.totalSenses,2)
  assert.deepEqual(result?.senses.map(s=>s.glosses),[['word'],['language']])
  assert.equal(await d({word:word('語','ご','語','動詞'),language:'en'}),null)
  assert.equal((await d({word:word('語','かたり'),language:'fr'}))?.language,'fr')
  assert.equal(await d({word:{...word('語','ご'),properName:{entityType:'person',source:'test'}},language:'en'}),null)
})

test('failed/malformed shards fail safely and retry; repeated lookups share in-flight loads',async()=>{
  let count=0
  const d=createDictionary(async key=>{count++; if(count===1) throw Error('missing'); return load(key)})
  const query={word:word('証拠','しょうこ'),language:'fr' as const}
  await assert.rejects(d(query))
  await Promise.all([d(query),d(query)])
  assert.equal(count,2)
  for(const data of [[],null,{'証拠':[{}]}]) await assert.rejects(createDictionary(async()=>data)(query))
})

test('browser loader reads raw gzip, validates integrity, and handles missing assets',async()=>{
  const previous=globalThis.fetch
  let requests=0
  try {
    globalThis.fetch=async input=>{ requests++; const file=String(input).split('/').at(-1)!; return new Response(await readFile(new URL(file,root))) }
    const d=createBrowserDictionary('https://offline.invalid/app/assets/jmdict/')
    const query={word:word('証拠','しょうこ'),language:'fr' as const}
    assert.equal((await d(query))?.language,'fr')
    await d(query); assert.equal(requests,2)
    globalThis.fetch=async()=>new Response('',{status:404})
    await assert.rejects(createBrowserDictionary('/missing/')(query))
  } finally { globalThis.fetch=previous }
})
