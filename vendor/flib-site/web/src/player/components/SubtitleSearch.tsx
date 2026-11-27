import { useMemo, useState } from 'react'
import type { Cue } from '../hooks/useSubtitles'

// Клиентский поиск по субтитрам (EN+RU): регулярка (case-insensitive); при невалидном
// паттерне — плоский substring-fallback (не падаем). Клик по результату → отдаёт
// ИНДЕКС cue в исходном массиве (не время — вызывающая сторона, PlayerPage.selectCue,
// сама решает про range+seek+view-shift).
interface SearchHit { cue: Cue; idx: number }

// ruHidden — первый проход ролика маршрута (спека кабинета §4.7 п.5): поиск идёт
// только по английскому тексту — русская строка не используется вовсе.
// enHidden — тот же первый проход (прод 2026-11-19, ревью M-1): поиск выключен
// целиком — он печатал бы найденные английские строки.
export function SubtitleSearch({ cues, onPick, ruHidden = false, enHidden = false }: { cues: Cue[]; onPick: (index: number) => void; ruHidden?: boolean; enHidden?: boolean }) {
  const [q, setQ] = useState('')
  const { results, invalid } = useMemo(() => {
    const s = q.trim()
    if (!s || enHidden) return { results: [] as SearchHit[], invalid: false }
    let match: (t: string) => boolean
    let invalid = false
    try {
      const re = new RegExp(s, 'i')          // regex-режим
      match = (t) => re.test(t)
    } catch {
      invalid = true                         // битый паттерн → literal substring
      const low = s.toLowerCase()
      match = (t) => t.toLowerCase().includes(low)
    }
    const hits: SearchHit[] = []
    cues.forEach((cue, idx) => { if (match(cue.text_en) || (!ruHidden && match(cue.text_ru))) hits.push({ cue, idx }) })
    return { results: hits.slice(0, 50), invalid }
  }, [cues, q, ruHidden, enHidden])
  return (
    <div className="sub-search" data-testid="sub-search">
      <input
        data-testid="search-input"
        className={`ss-input${invalid ? ' ss-invalid' : ''}`}
        type="text"
        placeholder={enHidden ? 'Поиск откроется после первого просмотра' : 'Поиск (regex)…'}
        disabled={enHidden}
        value={enHidden ? '' : q}
        onChange={e => setQ(e.target.value)}
      />
      {results.length > 0 && (
        <div className="ss-results" data-testid="search-results">
          {results.map(({ cue, idx }, i) => (
            <button key={i} data-testid={`search-result-${i}`} className="ss-result" onClick={() => onPick(idx)}>
              {cue.text_en}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
