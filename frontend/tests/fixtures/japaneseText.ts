/** Character-neutral samples shared by typography tests and browser QA. */
export const JAPANESE_SAMPLES = {
  hiragana: 'こんにちは、よろしくお願いします。',
  katakana: 'キャラクター、プロフィール、コンピューター',
  kanji: '証拠、裁判、弁護士、検事、事件、記憶、調査、証言',
  mixed: '成歩堂さん、今日はCourt Recordを確認しましょう。',
  numerals: '事件番号は2026-10-26です。ＡＢＣ１２３とABC123。',
  spacing: '　証拠　記録　裁判　調査　証言　弁護士　検事　事件　',
  punctuation: '「異議あり！」『証言』（記録）【確認】……、。！？・ー〜～',
  combining: 'か\u3099、ハ\u309A、e\u0301、葛\u{E0100}、𠮷、👩🏽‍⚖️、🇯🇵。',
  latin: 'English apostrophe: don’t. Français : été, cœur ! Italiano: perché. Español: ¡Sí, señor!',
} as const

export const LONG_JAPANESE = [JAPANESE_SAMPLES.hiragana, JAPANESE_SAMPLES.kanji,
  JAPANESE_SAMPLES.mixed, JAPANESE_SAMPLES.numerals, JAPANESE_SAMPLES.punctuation].join('').repeat(3)
