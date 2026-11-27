// ClipWords.tsx — «+N сл.» и раскрытие «Новые слова и выражения · N» (спека
// 2026-11-17 §4.12; макет `cab-route.jsx:228,233-238`). Слова — `introduced`
// выданного ролика (поле `words`), выражение (строка с пробелом) — цветом
// акцента. Открыт один блок на страницу (состояние у DayView), повторный клик
// сворачивает. У строк под замком и при нуле слов надписи нет.
import { CabI } from '../cab-icons'

export function WordsToggle({ n, open, onToggle }: { n: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={'wbtn' + (open ? ' on' : '')} aria-expanded={open} onClick={onToggle}>
      +{n} сл.<CabI.chev />
    </button>
  )
}

export function WordsBlock({ words }: { words: string[] }) {
  return (
    <div className="wexp">
      <span className="mono">Новые слова и выражения · {words.length}</span>
      <div className="wcols">{words.map(w => <span key={w} className={w.includes(' ') ? 'ph' : ''}>{w}</span>)}</div>
    </div>
  )
}
