// KnowledgePage.tsx — «Мои знания» кабинета (v1: текст и ссылки YouTube).
// Вкладки макета (§5): «Добавить» / «Известные слова» / «Мои источники». Слова из
// материала уходят в профиль маршрута как «знаю на 100 %» (BFF, cabinet_knowledge.go).
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { PlacementLink } from '../PlacementLink'
import { usePlacement } from '../placement/use-placement'
import { approxWords, ruInt, usableResult } from '../placement-entry'
import { useSession } from '../../useSession'
import { CabinetSoon } from '../CabinetSoon'
import { KeyExpired, NoRouteRight } from '../route/RouteMessages'
import { cabinetRouteMarked } from '../route/route-storage'
import { AddTab } from './AddTab'
import { SourcesTab } from './SourcesTab'
import { WordsTab } from './WordsTab'
import '../route/route.css'
import './knowledge.css'

type Tab = 'add' | 'words' | 'sources'
const TABS: { id: Tab; label: string }[] = [
  { id: 'add', label: 'Добавить' },
  { id: 'words', label: 'Известные слова' },
  { id: 'sources', label: 'Мои источники' },
]

function Head({ action }: { action?: ReactNode }) {
  return (
    <div className="ph">
      <span className="mono">Мои знания</span>
      <h1>Что Вы <em>уже понимаете</em></h1>
      <p>Скажите, что Вы уже понимаете, — маршрут станет точнее.</p>
      {action}
    </div>
  )
}

// KnowledgePage — ворота, как у страницы маршрута: без метки BFF — «скоро»,
// ключ истёк — продление, нет права маршрута — объяснение (слова пишутся в
// профиль маршрута, без права шлюз ответил бы 403).
export function KnowledgePage() {
  const s = useSession()
  if (!cabinetRouteMarked()) return <CabinetSoon title="Мои знания" />
  if (s.state === 'expired') return <><Head /><KeyExpired demo={s.demo} /></>
  // Право известно только у активного снимка; при «unknown» (шлюз недоступен)
  // routeAllowed:false — это незнание, а не отказ: страница читает слова сама.
  if (s.state === 'active' && !s.routeAllowed) return <><Head /><NoRouteRight /></>
  return <KnowledgeBody keyPrefix={s.keyPrefix} />
}

function KnowledgeBody({ keyPrefix }: { keyPrefix: string }) {
  const [tab, setTab] = useState<Tab>('add')
  const [version, setVersion] = useState(0) // растёт после записи слов
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ add: null, words: null, sources: null })

  // Стрелки/Home/End по вкладкам (WAI-ARIA tabs, ручная активация не нужна — выбор сразу).
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex(t => t.id === tab)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = TABS.length - 1
    if (n < 0) return
    e.preventDefault()
    setTab(TABS[n].id)
    refs.current[TABS[n].id]?.focus()
  }

  const pl = usePlacement(true)
  const last = usableResult(pl.summary)
  // Сводка недоступна — кнопки нет вовсе (как будто теста не существует).
  const test = pl.summary ? (
    <PlacementLink className="btn pt-head-btn" testId="kn-placement">
      {last ? `Тест уровня: ${last.level}, ≈ ${ruInt(approxWords(last))} слов` : 'Пройти тест'}
    </PlacementLink>
  ) : null
  return (
    <>
      <Head action={test} />
      <div className="tabs" role="tablist" aria-label="Разделы" onKeyDown={onKey}>
        {TABS.map(t => (
          <button key={t.id} ref={el => { refs.current[t.id] = el }} type="button" role="tab" id={`kn-tab-${t.id}`}
            aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            // «Добавить» смонтирована всегда (hidden), остальные — только когда выбраны.
            aria-controls={t.id === 'add' || tab === t.id ? `kn-panel-${t.id}` : undefined}
            className={tab === t.id ? 'on' : ''} data-testid={`kn-tab-${t.id}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id="kn-panel-add" aria-labelledby="kn-tab-add" hidden={tab !== 'add'}>
        <AddTab keyPrefix={keyPrefix} onSaved={() => setVersion(v => v + 1)} />
      </div>
      {tab === 'words' && <div role="tabpanel" id="kn-panel-words" aria-labelledby="kn-tab-words"><WordsTab version={version} /></div>}
      {tab === 'sources' && <div role="tabpanel" id="kn-panel-sources" aria-labelledby="kn-tab-sources"><SourcesTab keyPrefix={keyPrefix} version={version} /></div>}
    </>
  )
}
