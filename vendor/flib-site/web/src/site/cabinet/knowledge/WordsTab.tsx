// WordsTab.tsx — «Известные слова» (макет §5): «ИЗВЕСТНО СЛОВ» и число крупно,
// поиск справа, сетка слов; список порциями. Удаления слов нет — BFF его не умеет.
import { useCallback, useEffect, useRef, useState } from 'react'
import { refreshSession } from '../../session'
import { fetchWords, type WordRow } from './knowledge-api'
import { statusLabel } from './knowledge-model'

const PAGE = 50
const SEARCH_DELAY_MS = 300

interface Props { version: number }

export function WordsTab({ version }: Props) {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('') // применённый поиск
  const [items, setItems] = useState<WordRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [matched, setMatched] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async (offset: number) => {
    const my = ++seq.current
    setLoading(true)
    setError(false)
    const r = await fetchWords({ q: query, offset, limit: PAGE })
    if (my !== seq.current) return // ответ устарел: поиск или версия уже другие
    setLoading(false)
    if (!r.ok) {
      if (r.status === 401) void refreshSession().catch(() => undefined)
      setError(true)
      return
    }
    setTotal(r.data.total)
    setMatched(r.data.matched)
    setItems(prev => (offset === 0 ? r.data.items : [...prev, ...r.data.items]))
  }, [query])

  // Новый поиск или запись слов в другой вкладке страницы — список с начала.
  useEffect(() => { void load(0) }, [load, version])

  const left = matched - items.length
  return (
    <div className="kn-words">
      <div className="words-top">
        <div>
          <div className="mono kn-cap">Известно слов</div>
          <div className="bigcount" data-testid="kn-words-count" aria-live="polite">{total === null ? '' : total.toLocaleString('ru-RU')}</div>
        </div>
        <div className="inp">
          <input type="search" data-testid="kn-search" value={q} placeholder="Найти слово" aria-label="Поиск по словам" maxLength={64} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      {error && <div className="msg err" role="alert" data-testid="kn-words-error"><p>Не удалось загрузить слова.{' '}
        <button type="button" className="link" onClick={() => void load(0)}>Повторить</button></p></div>}
      {!error && total === 0 && !loading && <p className="mute" data-testid="kn-words-empty">Пока пусто: добавьте материал на вкладке «Добавить» — слова из него станут известными.</p>}
      {!error && total !== null && total > 0 && matched === 0 && !loading && <p className="mute" data-testid="kn-words-nomatch">Такого слова нет среди известных.</p>}
      {items.length > 0 && (
        <div className="wgrid">
          {items.map(w => (
            <div key={w.lemma} data-testid="kn-row"><span>{w.lemma}</span>{statusLabel(w.status) === 'учу' && <span className="tag">учу</span>}</div>
          ))}
        </div>
      )}
      {loading && <p className="mute" data-testid="kn-words-loading">Загружаю слова…</p>}
      {!loading && !error && left > 0 && (
        <button type="button" className="btn" data-testid="kn-more" onClick={() => void load(items.length)}>Показать ещё (осталось {left})</button>
      )}
    </div>
  )
}
