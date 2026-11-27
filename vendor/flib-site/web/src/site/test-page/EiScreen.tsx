// EiScreen.tsx — экран 4: повтор / elicited imitation (ТЗ-5, опционально,
// DESIGN_SPEC.md §5, temp/flib/test.jsx RepeatScreen).
//
// v1 без микрофона (задача Э4 п.3): только текстовый ввод "по памяти" —
// прод-вариант с 🎤/ASR из прототипа НЕ переносится (нет живого ASR-бэка в
// этом этапе). «Пропустить этап» завершает шаг с уже накопленными ответами
// (без штрафа за оставшиеся фразы — DESIGN_SPEC §5 «пропуск шага без
// штрафа» — обязательная механика) — так же, как обычное завершение на
// последней фразе, просто раньше.
//
// Ничего не скорится по мере ввода — responses копит СЫРЫЕ пары
// [sentence, typed] (estimateEI сама зовёт scoreEISentence на каждую пару
// внутри, см. math.ts).
import { useState } from 'react'
import { EI_SENTENCES, estimateEI, sentenceText, vocabSigmaFromCi90, type EISentence, type EiResult, type VocabResult } from './math'
import { useTts } from './useTts'
import { AudioOrb, RepeatBtn } from './AudioWidgets'

interface EiScreenProps {
  vocabResult: VocabResult
  onDone: (result: EiResult) => void
}

export function EiScreen({ vocabResult, onDone }: EiScreenProps) {
  const sentences = EI_SENTENCES
  const M = sentences.length
  const [i, setI] = useState(0)
  const [txt, setTxt] = useState('')
  const [responses, setResponses] = useState<Array<[EISentence, string]>>([])

  const current = sentences[i]
  const tts = useTts(sentenceText(current))

  function finalize(finalResponses: Array<[EISentence, string]>) {
    const thetaVocab = vocabResult.finalMu
    const vocabSigma = vocabSigmaFromCi90(vocabResult.ci90)
    onDone(estimateEI(finalResponses, thetaVocab, vocabSigma))
  }

  function next() {
    const updated: Array<[EISentence, string]> = [...responses, [current, txt]]
    if (i >= M - 1) {
      finalize(updated)
      return
    }
    setResponses(updated)
    setTxt('')
    setI(i + 1)
  }

  function skip() {
    // Пропуск всего шага — считаем то, что уже собрали, не штрафуем за
    // оставшиеся фразы (DESIGN_SPEC §5).
    finalize(responses)
  }

  return (
    <div className="tcard center">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Шаг 4 · повтор · опционально</div>
      <h2>Повтор</h2>
      <p className="instr">Послушайте фразу и напечатайте её целиком по памяти. Длинные фразы сложнее — это и есть сигнал.</p>
      <div className="asym" style={{ marginTop: 22 }}><i style={{ width: `${Math.round((i / M) * 100)}%` }} /></div>

      <div className="audio-zone">
        <AudioOrb tts={tts} />
        <RepeatBtn tts={tts} />
      </div>

      <textarea
        className="dict-input"
        value={txt}
        onChange={e => setTxt(e.target.value)}
        placeholder="Повторите фразу по памяти…"
        maxLength={500}
        disabled={tts.state === 'loading'}
        aria-label="Повторите фразу по памяти"
      />

      <div className="tcard-actions">
        <button type="button" className="btn btn-amber btn-lg" onClick={next}>Дальше →</button>
        <button type="button" className="link-btn" onClick={skip}>Пропустить этап (нет микрофона) — без штрафа</button>
        <div className="phrase-count">фраза {i + 1} из {M}</div>
      </div>
    </div>
  )
}
