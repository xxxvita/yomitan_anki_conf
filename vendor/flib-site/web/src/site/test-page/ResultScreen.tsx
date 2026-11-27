// ResultScreen.tsx — экран 6: итог (ТЗ-6, DESIGN_SPEC.md §7,
// temp/flib/test.jsx ResultScreen).
//
// Расширяет прототип: задача Э4 требует обязательный выбор ЦЕЛИ (GoalChips,
// как на /import — тест сам по себе цели маршрута не собирает, «Какой
// сериал хочешь понимать» на анкете идёт только в synthesize()'s
// необязательный target, не в goal_ids маршрута, см. SurveyScreen.tsx) и
// явный выбор ОДНОГО пресета перед «Показать мой маршрут» (в прототипе
// кнопка «Создать маршрут» ни от чего не зависела — здесь она должна знать,
// чьи слова грузить).
//
// UNVERIFIED-ветка: math-слой сам решает надёжность (synth.ts buildCore —
// `reliable = !vocab.flags.some(f => f.startsWith('UNVERIFIED'))`, и уже
// обнуляет presets=[] в этом случае) — здесь просто читаем
// synthResult.profile.reliable, не дублируем логику флагов.
//
// Источник слов для пресета — GET /api/dicts/cefr/C1 (топ-6000, самый
// длинный список, план Э4 п.3 «итог»): topNWords(corpus, preset.lemmas)
// берёт первые N самых частотных слов корпуса под объём пресета. Тот же
// список используется для скачивания known-words.json с карточки пресета
// (⚠️ формат задан задачей буквально: [{word, added_at, source:'flib-test'}]
// — НЕ формат прототипа {source,point,count,known}, тот был плейсхолдером
// на выдуманных словах).
import { useEffect, useState } from 'react'
import { GoalChips } from '../GoalChips'
import { STATIC_GOALS } from '../data'
import { savePointA } from '../pointA'
import { topNWords, type SynthResult, type SynthPreset, type VocabResult, type EiResult } from './math'

interface ResultScreenProps {
  vocabResult: VocabResult
  synthResult: SynthResult
  eiResult: EiResult | null
  onRestart: () => void
  onRouteCreated: () => void
}

function downloadKnownWords(words: string[]) {
  const payload = words.map(word => ({ word, added_at: new Date().toISOString(), source: 'flib-test' }))
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'known-words.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Человекочитаемая подпись маршрута (SynthFit.route, test/types.ts FitRoute)
// — математика отдаёт машинный код, дизайн (DESIGN_SPEC.md §7.2) просит
// "человекочитаемую подпись".
const ROUTE_LABEL: Record<string, string> = {
  retest: 'Пересдать короткий блок',
  slow_track: 'Подготовительный трек',
  shadowing_heavy: 'Шедоуинг (усиленный)',
  shadowing_boost: 'Шедоуинг (буст)',
  cards_first: 'Карточки → видео',
  standard: 'Стандартный · просмотр + подсветка',
}

export function ResultScreen({ vocabResult, synthResult, eiResult, onRestart, onRouteCreated }: ResultScreenProps) {
  const [goals, setGoals] = useState<string[]>([])
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [corpusWords, setCorpusWords] = useState<string[] | null>(null)
  const [corpusError, setCorpusError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showJson, setShowJson] = useState(false)

  const { profile, fit, presets } = synthResult
  const unverified = !profile.reliable

  useEffect(() => {
    // Пресет по умолчанию — рекомендованный (rec:true), если есть.
    const rec = presets.find(p => p.rec)
    if (rec && !selectedPreset) setSelectedPreset(rec.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthResult])

  useEffect(() => {
    let cancelled = false
    fetch('/api/dicts/cefr/C1')
      .then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json() })
      .then((data: { words?: string[] }) => {
        if (cancelled) return
        const words = Array.isArray(data.words) ? data.words : []
        setCorpusWords(words)
        // 200 с пустым words — тоже нерабочий корпус (аудит HIGH #2): без
        // этого canSubmit пропустил бы pointA с words:[] молча, а карточки
        // пресетов остались бы пустыми без единого предупреждения.
        if (words.length === 0) setCorpusError(true)
      })
      .catch(() => { if (!cancelled) setCorpusError(true) })
    return () => { cancelled = true }
  }, [])

  function wordsFor(preset: SynthPreset): string[] {
    if (!corpusWords) return []
    return topNWords(corpusWords, preset.lemmas)
  }

  const canSubmit = !unverified && Boolean(selectedPreset) && goals.length > 0 && Boolean(corpusWords && corpusWords.length > 0) && !submitting

  async function handleShowRoute() {
    if (!canSubmit) return
    const preset = presets.find(p => p.name === selectedPreset)
    if (!preset) return
    setSubmitting(true)
    // source:'test' + levelEstimate — задача P-profile-feed (2026-07-14):
    // тест физически не собирает интересы (нет UI, см. отсутствие GoalChips
    // для интересов на этом экране) и не собирает возраст — pointA несёт
    // только то, что реально есть в этом пути. profile.cefr — "справочная"
    // CEFR-оценка (уже отрисована выше как badge) — единственная оценка
    // уровня, которую test-путь реально производит.
    savePointA({ kind: 'words', words: wordsFor(preset), goals, source: 'test', levelEstimate: profile.cefr, savedAt: new Date().toISOString() })
    onRouteCreated()
  }

  function toggleGoal(id: string) {
    setGoals(prev => (prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]))
  }

  if (unverified) {
    return (
      <div className="tcard">
        <div className="result-hero">
          <div className="eyebrow">Итог · Ваша точка А</div>
          <div className="unverified-box">
            <div className="ub-ic">⚠️</div>
            <h3>Не удалось надёжно измерить</h3>
            <p>{fit.msg ?? 'Ответы выглядели непоследовательно — число словаря мы скрыли, чтобы не дать оценку, которой нельзя доверять. Пройдите короткий блок заново.'}</p>
            <button type="button" className="btn btn-amber btn-lg" style={{ maxWidth: 320 }} onClick={onRestart}>Пересдать короткий блок</button>
          </div>
        </div>
      </div>
    )
  }

  const lo = Math.round(vocabResult.ci90[0])
  const hi = Math.round(vocabResult.ci90[1])
  const eiSkipped = eiResult == null || eiResult.skipped

  return (
    <div>
      <div className="tcard">
        <div className="result-hero">
          <div className="eyebrow">Итог · Ваша точка А</div>
          <div className="big-range">≈ {lo}–{hi} <span className="u">слов</span></div>
          <div className="range-sub">словарь на слух · всегда диапазон, не точка</div>
          <div className="badge-row">
            <span className="badge good">✓ надёжно</span>
            <span className="badge warn">CEFR {profile.cefr} · справочно</span>
          </div>
        </div>

        <div className="profile-card">
          <div className="profile-row"><span className="pr-k">Словарь на слух</span><span className="pr-v">≈ {vocabResult.sizeLemmas} <span className="range-sub">({lo}–{hi})</span></span></div>
          <div className="profile-row"><span className="pr-k">CEFR<span className="ref">справочно</span></span><span className="pr-v">{profile.cefr}</span></div>
          <div className="profile-row"><span className="pr-k">Декодирование (слух)</span><span className="pr-v">{profile.decodingBand != null ? profile.decodingBand.toFixed(1) : '—'}</span></div>
          <div className="profile-row"><span className="pr-k">Разрыв словарь ↔ слух</span><span className="pr-v">{profile.decodingGap != null ? (profile.decodingGap > 0 ? `+${profile.decodingGap}` : profile.decodingGap) : '—'}</span></div>
          <div className="profile-row"><span className="pr-k">Повтор (EI)</span><span className="pr-v">{eiSkipped ? 'пропущен' : profile.eiBand?.toFixed(1)}</span></div>
          <div className="profile-row"><span className="pr-k">Надёжность</span><span className="pr-v"><span className="badge good">✓ ок</span></span></div>
        </div>

        <div className="verdict-card">
          <div className="vc-title">{fit.msg ?? fit.routeMsg ?? 'Ваш маршрут готов'}</div>
          <div className="vc-meta">
            <div className="m">Маршрут<b>{fit.route ? ROUTE_LABEL[fit.route] ?? fit.route : '—'}</b></div>
            {fit.cov != null && <div className="m">Покрытие цели<b>{Math.round(fit.cov * 100)}%</b></div>}
            {fit.eta != null && <div className="m">Дойдёте за<b>≈ {fit.eta} нед.</b></div>}
          </div>
        </div>

        <div className="presets-head">
          <h3>Стартовые словари — точка А</h3>
          <p>Реальные слова, которые Вы уже знаете (топ по частоте, имена вычищены), в формате проекта. Выберите один — маршрут построится под него.</p>
        </div>
        {corpusError && <div className="soft-alert"><span className="ai">⚠</span><span>Не удалось загрузить частотный словарь. Обновите страницу и попробуйте снова.</span></div>}
        <div className="preset-grid">
          {presets.map(p => (
            // Не <button> целиком: карточка несёт ДВА независимых действия
            // (выбрать пресет для маршрута / скачать его файл) — вложенные
            // интерактивные элементы (button-в-button) невалидны, поэтому
            // это div с двумя соседними кнопками, не одна большая кликабельная
            // область (см. ForkPage.tsx для примера, где кнопка ровно одна).
            <div key={p.name} className={`preset ${p.rec ? 'rec' : ''} ${selectedPreset === p.name ? 'sel' : ''}`}>
              {p.rec && <span className="rec-badge">рекомендуем</span>}
              <div className="p-title">{p.name}</div>
              <div className="p-lemmas">{p.lemmas} <small>лемм</small></div>
              <div className="p-stats">
                {p.note ?? p.icp ?? ''}
                {p.cov != null && <><br />покрытие цели <b>{Math.round(p.cov * 100)}%</b></>}
                {p.eta != null && <><br />ETA <b>≈ {p.eta} нед.</b></>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${selectedPreset === p.name ? 'btn-amber' : 'btn-ghost'}`}
                  style={{ flex: 1 }}
                  aria-pressed={selectedPreset === p.name}
                  onClick={() => setSelectedPreset(p.name)}
                >
                  {selectedPreset === p.name ? '✓ выбран' : 'Выбрать'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!corpusWords || corpusWords.length === 0}
                  onClick={() => downloadKnownWords(wordsFor(p))}
                >
                  ⬇ known-words.json
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="setup-field">
          <label className="lbl">Цель — что хотите понимать</label>
          <GoalChips goals={STATIC_GOALS} selected={goals} onToggle={toggleGoal} />
          <div className="setup-note">Можно выбрать несколько целей — маршрут объединит их.</div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button type="button" className="btn btn-amber btn-lg" disabled={!canSubmit} onClick={() => void handleShowRoute()}>
            Показать мой маршрут →
          </button>
        </div>

        {showJson && (
          <div className="raw-json">{JSON.stringify({ vocab: [lo, hi], profile, fit }, null, 2)}</div>
        )}

        <div className="result-actions">
          <button type="button" className="link-btn" onClick={onRestart}>↻ Пройти заново</button>
          <button type="button" className="link-btn" onClick={() => setShowJson(s => !s)}>{showJson ? 'Скрыть' : 'Показать'} сырой JSON · для разработчиков</button>
        </div>
      </div>
    </div>
  )
}
