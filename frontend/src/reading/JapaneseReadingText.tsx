import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TypewriterText } from '../components/TypewriterText.tsx'
import { revealParts } from '../engine/unicodeText.ts'
import { useT } from '../i18n/useT.ts'
import { containsKanji, popupPosition, type ReadingWord, type WordRect } from './japaneseReading.ts'
import './reading.css'
import { containsProperName } from './properNames.ts'
import { useSettings } from '../settings/settings.ts'
import type { Definition } from './japaneseDictionary.ts'

interface Selection { word: ReadingWord; text: string; target: HTMLElement; pinned: boolean }

function ReadingPopup({ selection, stage, close, enter, leave }: {
  selection: Selection; stage: HTMLElement; close: () => void; enter: () => void; leave: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 2, top: 2 })
  const t = useT()
  const { settings } = useSettings()
  const language = settings.language === 'en' ? 'en' : settings.japaneseDefinitionLanguage
  const [lookup, setLookup] = useState<{key: string; result: Definition | null; error: boolean} | null>(null)
  const key = JSON.stringify([selection.word, language])
  const result = lookup?.key === key ? lookup.result : null
  const failed = lookup?.key === key && lookup.error
  useEffect(() => {
    let abandoned = false
    if (!selection.word.properName) void import('./japaneseTokenizer.ts').then(module => module.lookupJapanese({word:selection.word, language})).then(
      result => { if (!abandoned) setLookup({key, result, error:false}) },
      () => { if (!abandoned) setLookup({key, result:null, error:true}) },
    )
    return () => { abandoned = true }
  }, [key, language, selection.word])
  useLayoutEffect(() => {
    const viewport = stage.getBoundingClientRect()
    const scale = viewport.width / 256
    const target = selection.target.getClientRects()[0] ?? selection.target.getBoundingClientRect()
    const rect: WordRect = { left: (target.left - viewport.left) / scale,
      top: (target.top - viewport.top) / scale, bottom: (target.bottom - viewport.top) / scale }
    const popup = box.current!.getBoundingClientRect()
    setPosition(popupPosition(rect, popup.width / scale, popup.height / scale))
  }, [selection, stage, result, failed])
  return createPortal(<div ref={box} className="reading-popup" role="dialog" aria-label={selection.word.surface}
    style={position} onPointerEnter={enter} onPointerLeave={leave} onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close() } }}>
    <button type="button" className="reading-close" aria-label={t('common.close')} onClick={close}>×</button>
    <div className="reading-surface" lang="ja">{selection.word.surface}</div>
    <div className="reading-hiragana" lang="ja">{selection.word.reading}</div>
    {selection.word.properName && <div className="reading-definition">
      <div lang="en">{selection.word.properName.english}</div><small>{t('reading.properName')}</small>
    </div>}
    {result && <div className="reading-definition">
      {result.base !== selection.word.surface && <div lang="ja" className="reading-base">{result.base}</div>}
      <small>{result.language.toUpperCase()} · {t('reading.meanings')}{result.totalSenses > 1 ? ` (${result.totalSenses})` : ''}</small>
      <ol lang={result.language}>{result.senses.map((sense,i) => <li key={`${sense.id}-${i}`} title={[...sense.tags,...sense.notes].join('; ')}>{sense.glosses.join(' ; ')}</li>)}</ol>
    </div>}
    {failed && <small role="status" className="reading-definition">{t('reading.dictionaryError')}</small>}
    {!selection.word.properName && <a className="reading-source" href={`${import.meta.env.BASE_URL}assets/jmdict/NOTICE.html`} target="_blank" rel="noreferrer">JMdict · EDRDG</a>}
  </div>, stage)
}

/** Text is partitioned, never replaced; analysis depends on the full page, not reveal ticks. */
export function JapaneseReadingText({ text, visibleCount }: { text: string; visibleCount: number }) {
  const t = useT()
  const [stage, setStage] = useState<HTMLElement | null>(null)
  const attachHost = useCallback((node: HTMLSpanElement | null) => {
    if (node) setStage(node.closest<HTMLElement>('.scene-stage'))
  }, [])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [analysis, setAnalysis] = useState<{ text: string; words: ReadingWord[]; error: boolean }>({text: '', words: [], error: false})
  const [selection, setSelection] = useState<Selection | null>(null)
  const visible = revealParts(text, visibleCount)[0].length
  const selected = selection?.text === text && selection.word.end <= visible ? selection : null
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const dismiss = () => { clearTimer(); setSelection(null) }
  const leave = () => {
    clearTimer()
    timer.current = setTimeout(() => setSelection(current => current?.pinned ? current : null), 180)
  }
  useEffect(() => {
    let abandoned = false
    if (containsKanji(text) || containsProperName(text)) void import('./japaneseTokenizer.ts').then(module => module.analyzeJapanese(text)).then(
      words => { if (!abandoned) setAnalysis({ text, words, error: false }) },
      () => { if (!abandoned) setAnalysis({ text, words: [], error: true }) },
    )
    return () => { abandoned = true; if (timer.current) clearTimeout(timer.current) }
  }, [text])
  useEffect(() => {
    if (!selected) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && (target.closest('.reading-word') || target.closest('.reading-popup'))) return
      setSelection(null)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [selected])

  const words = analysis.text === text ? analysis.words : []
  const pieces = []
  let cursor = 0
  const plain = (start: number, end: number) => {
    if (end > start) pieces.push(<TypewriterText key={`plain-${start}`} text={text.slice(start, end)} visibleCount={Math.max(0, visible - start)} />)
  }
  for (const word of words) {
    plain(cursor, word.start)
    const complete = word.end <= visible
    if (!complete) plain(word.start, word.end)
    else pieces.push(<span key={`word-${word.start}`} className="reading-word" role="button" tabIndex={0}
      aria-haspopup="dialog" aria-expanded={selected?.word.start === word.start}
      onPointerEnter={event => {
        if (event.pointerType === 'touch') return
        clearTimer()
        const target = event.currentTarget
        timer.current = setTimeout(() => setSelection({word, text, target, pinned: false}), 220)
      }}
      onPointerLeave={leave}
      onFocus={event => { clearTimer(); setSelection({word, text, target: event.currentTarget, pinned: false}) }}
      onBlur={leave}
      onClick={event => { event.stopPropagation(); clearTimer(); setSelection({word, text, target: event.currentTarget, pinned: true}) }}
      onKeyDown={event => {
        if (['Enter', ' ', 'Escape'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation()
          if (event.key === 'Escape') dismiss()
          else { clearTimer(); setSelection({word, text, target: event.currentTarget, pinned: true}) }
        }
      }}>{text.slice(word.start, word.end)}</span>)
    cursor = word.end
  }
  plain(cursor, text.length)
  return <><span ref={attachHost} className="reading-text">{pieces}</span>
    {selected && stage && <ReadingPopup selection={selected} stage={stage} close={dismiss} enter={clearTimer} leave={leave} />}
    {analysis.text === text && analysis.error && stage && createPortal(
      <span className="reading-error" role="status" title={t('reading.error')}>{t('reading.error')}</span>, stage)}
  </>
}
