// VocabScreen.tsx — экран 2: словарь на слух, ядро оценки (ТЗ-3,
// DESIGN_SPEC.md §3, temp/flib/test.jsx VocabScreen).
//
// Адаптивный Yes/Кажется/No-цикл поверх AuralEngine (math.ts): 24–40
// айтемов переменной длины, ранняя остановка подаётся позитивно
// ("Достаточно — мы уверены в оценке"), баллы по ходу НЕ показываются
// (DESIGN_SPEC §3 — "это принципиально").
import { useEffect, useMemo, useState } from 'react'
import { AuralEngine, type VocabItem, type VocabResult, type Prior } from './math'
import { useTts } from './useTts'
import { AudioOrb, RepeatBtn, TtsAlert } from './AudioWidgets'

type Answer = 'yes' | 'seems' | 'no'

const ANSWER_BUTTONS: [Answer, string, string][] = [
  ['yes', '✅ Знаю', '1'],
  ['seems', '🤔 Кажется', '2'],
  ['no', '❌ Не знаю', '3'],
]

// Ожидаемый верхний предел айтемов методики (24–40, план Э4/DESIGN_SPEC
// §3) — используется только для надписи «N из ~40» и оценки прогресс-бара,
// не для остановки цикла (её решает engine.done).
const EXPECTED_MAX_ITEMS = 40

interface VocabScreenProps {
  prior: Prior
  onDone: (result: VocabResult) => void
}

export function VocabScreen({ prior, onDone }: VocabScreenProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- движок создаётся ровно один раз на маунт экрана, prior не переизбирается
  const engine = useMemo(() => new AuralEngine({ priorMu: prior.mu, priorSigma: prior.sigma }), [])
  const [item, setItem] = useState<VocabItem | null>(() => engine.next())
  const [answered, setAnswered] = useState(0)
  const [enough, setEnough] = useState(false)

  const tts = useTts(item ? item.word : '')
  const answersReady = tts.state === 'ready'

  useEffect(() => {
    // next() уже вернул null на первом айтеме (движок сразу done) —
    // методика не гарантирует минимум >0 айтемов при экстремальном приоре.
    if (!item && engine.done) {
      setEnough(true)
      onDone(engine.result())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  function handleAnswer(ans: Answer) {
    if (!answersReady || !item) return
    engine.answer(ans)
    setAnswered(a => a + 1)
    if (engine.done) {
      setEnough(true)
      // Небольшая пауза перед переходом — та же UX-подсказка "Достаточно",
      // что в temp/flib/test.jsx:219 (не обрыв, а позитивная остановка).
      setTimeout(() => onDone(engine.result()), 900)
    } else {
      setItem(engine.next())
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!answersReady) return
      if (e.key === '1') handleAnswer('yes')
      else if (e.key === '2') handleAnswer('seems')
      else if (e.key === '3') handleAnswer('no')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answersReady, item])

  // Асимптотический прогресс (temp/flib/test.jsx:232): тянется к ~80%,
  // "дозаполняется" до 100% на ранней остановке — переменная длина
  // (24-40 айтемов) не должна давать скачков назад.
  const pct = enough ? 100 : Math.round(80 * (1 - Math.exp(-answered / 4)))

  if (!item) return null

  return (
    <div className="tcard center">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Шаг 2 · ядро оценки</div>
      <h2>Словарь на слух</h2>
      <p className="instr">Слушайте слово и честно отвечайте. Некоторые слова выдуманы (проверка) — если не уверены, жмите «Не знаю».</p>
      <div className="asym" style={{ marginTop: 22 }}><i style={{ width: pct + '%' }} /></div>
      {enough && <div className="enough-tag">Достаточно — мы уверены в оценке ✓</div>}

      <TtsAlert tts={tts} />
      <div className="audio-zone">
        <AudioOrb tts={tts} big />
        <RepeatBtn tts={tts} />
        <div className="audio-note">нажмите «Повторить», чтобы услышать снова</div>
      </div>

      <div className="ans-row">
        {ANSWER_BUTTONS.map(([ans, label, key]) => (
          <button key={ans} type="button" className="ans-btn" disabled={!answersReady} onClick={() => handleAnswer(ans)}>
            {label}<span className="k">клавиша {key}</span>
          </button>
        ))}
      </div>
      <div className="sub-note">оценка правильности по ходу не показывается — это принципиально</div>
      <div className="phrase-count">{answered} из ~{EXPECTED_MAX_ITEMS}</div>
    </div>
  )
}
