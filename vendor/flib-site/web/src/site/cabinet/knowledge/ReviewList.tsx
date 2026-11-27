// ReviewList.tsx — «Посмотреть слова»: страницы по 50 с галочками (как в
// приложении). Снятые галочки живут между страницами.
import { useMemo, useState } from 'react'
import type { NewWord } from './knowledge-api'
import { pageCount, pageSlice, REVIEW_PAGE } from './knowledge-model'

interface Props {
  words: NewWord[]
  busy: boolean
  onSave: (lemmas: string[]) => void
  onDiscard: () => void
}

export function ReviewList({ words, busy, onSave, onDiscard }: Props) {
  const [page, setPage] = useState(0)
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const pages = pageCount(words.length)
  const rows = pageSlice(words, page)
  const selected = useMemo(() => words.filter(w => !unchecked.has(w.lemma)).map(w => w.lemma), [words, unchecked])
  const toggle = (l: string) => setUnchecked(prev => {
    const next = new Set(prev)
    if (next.has(l)) next.delete(l); else next.add(l)
    return next
  })
  const uncheckPage = () => setUnchecked(prev => {
    const next = new Set(prev)
    for (const w of rows) next.add(w.lemma)
    return next
  })
  return (
    <div className="kn-review">
      <ul className="kn-wordlist">
        {rows.map(w => (
          <li key={w.lemma} data-testid="kn-word">
            <label>
              <input type="checkbox" data-testid={`kn-check-${w.lemma}`} checked={!unchecked.has(w.lemma)} disabled={busy} onChange={() => toggle(w.lemma)} />
              <span className="kn-lemma">{w.lemma}</span>
              {w.kind !== 'word' && <span className="tag">{w.kind === 'idiom' ? 'идиома' : 'выражение'}</span>}
              {w.forms.length > 0 && <span className="mute kn-forms">{w.forms.join(', ')}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="kn-pager">
        <button type="button" className="btn sm" data-testid="kn-page-prev" disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}>Назад</button>
        <span className="mute">Страница {page + 1} из {pages}</span>
        <button type="button" className="btn sm" data-testid="kn-page-next" disabled={page >= pages - 1 || busy} onClick={() => setPage(p => p + 1)}>Дальше</button>
        <button type="button" className="btn sm" data-testid="kn-uncheck-page" disabled={busy} onClick={uncheckPage}>Снять все на странице</button>
      </div>
      <div className="kn-actions">
        <button type="button" className="btn primary" data-testid="kn-add-selected" disabled={busy || selected.length === 0} onClick={() => onSave(selected)}>
          Добавить выбранные ({selected.length})
        </button>
        <button type="button" className="btn" data-testid="kn-discard" disabled={busy} onClick={onDiscard}>Добавить ещё материал</button>
      </div>
    </div>
  )
}

export { REVIEW_PAGE }
