// DictationScreen.tsx — экран 3: диктант (ТЗ-4, DESIGN_SPEC.md §4,
// temp/flib/test.jsx DictationScreen).
//
// Ничего не скорится по мере ввода (не по мере ввода — задача Э4 п.3): на
// «Дальше» в responses копится СЫРАЯ пара [sentence, typed] (не результат
// scoreDictSentence — тот дорогой пер-токен-скоринг делает сама
// estimateDecoding внутри, вызывая scoreDictSentence на каждую пару, см.
// math.ts). Один вызов estimateDecoding на последней фразе. Пустой ответ —
// валидный «не расслышал», без штрафа (DESIGN_SPEC §4).
import { useState } from 'react'
import { DICTATION_SENTENCES, estimateDecoding, sentenceText, vocabSigmaFromCi90, type DecodingResult, type DictationSentence, type VocabResult } from './math'
import { useTts } from './useTts'
import { AudioOrb, RepeatBtn } from './AudioWidgets'

interface DictationScreenProps {
  vocabResult: VocabResult
  onDone: (result: DecodingResult) => void
}

export function DictationScreen({ vocabResult, onDone }: DictationScreenProps) {
  const sentences = DICTATION_SENTENCES
  const M = sentences.length
  const [i, setI] = useState(0)
  const [val, setVal] = useState('')
  const [responses, setResponses] = useState<Array<[DictationSentence, string]>>([])

  const current = sentences[i]
  const tts = useTts(sentenceText(current))

  function next() {
    const updated: Array<[DictationSentence, string]> = [...responses, [current, val]]
    if (i >= M - 1) {
      const thetaVocab = vocabResult.finalMu
      const vocabSigma = vocabSigmaFromCi90(vocabResult.ci90)
      onDone(estimateDecoding(updated, thetaVocab, vocabSigma))
      return
    }
    setResponses(updated)
    setVal('')
    setI(i + 1)
  }

  return (
    <div className="tcard center">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Шаг 3 · декодирование речи</div>
      <h2>Диктант</h2>
      <p className="instr">Слушайте фразу и печатайте, что расслышали. Можно повторить до 2 раз. Стяжения (she’d, gonna) и опечатки — не страшно.</p>
      <div className="asym" style={{ marginTop: 22 }}><i style={{ width: `${Math.round((i / M) * 100)}%` }} /></div>

      <div className="audio-zone">
        <AudioOrb tts={tts} />
        <RepeatBtn tts={tts} />
      </div>

      <textarea
        className="dict-input"
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="Напечатайте, что услышали…"
        maxLength={500}
        disabled={tts.state === 'loading'}
        aria-label="Что Вы услышали"
      />
      <div style={{ textAlign: 'left', maxWidth: '100%' }} className="sub-note">пусто — тоже валидный ответ («не расслышали»), без штрафа</div>

      <div className="tcard-actions">
        <button type="button" className="btn btn-amber btn-lg" onClick={next}>Дальше →</button>
        <div className="phrase-count">фраза {i + 1} из {M}</div>
      </div>
    </div>
  )
}
