// TitleDetail.tsx — подробная карточка тайтла (дизайн §3d, спека §7.6): панель справа
// до 560 px, на телефоне — весь экран. Читает `item` ответа деталей и `pace` конверта;
// `snapshot` из списка уходит в запрос, `409` — перечитывает версию (одна попытка) и
// просит карточку заново. Пять групп слов — как их отдал шлюз: «+ ещё N» — поле `more`,
// страница ничего не вычитает; `free_forms` в ответе нет. Блока «Вы знаете N %» и
// «Скрыть знакомые» нет (нужен словарь пользователя), полного списка слов нет.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CabI } from '../cab-icons'
import { GoalPoster } from '../route/GoalPoster'
import { CATALOG_UNAVAILABLE_TEXT, imdbUrl, TITLE_OFF_TEXT, TOO_MANY_TITLES_TEXT, typeLabel } from '../route/start-model'
import { titleDetail, titlesBySlugs, type TitleCard, type TitleDetailResp } from './catalog-api'
import {
  DETAIL_UNAVAILABLE, FIRST_EPISODE_NOTE, formatCount, formatShare, formsLabel, groupsToShow, paceBucket, paceMarks,
  phraseCountLabel, tempoSourceLabel, WORDS_HINT, wpmWord,
} from './catalog-model'
import { useDialog } from './use-dialog'
import './catalog.css'

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; data: TitleDetailResp }
  | { kind: 'notfound' }
  | { kind: 'error' }

export interface TitleDetailProps {
  card: TitleCard
  /** Версия списка, из которого открыли карточку (нет — без проверки версии). */
  snapshot?: string
  selected: boolean
  /** Выбрано 10 тайтлов: новый выбрать нельзя, снять можно. */
  capped: boolean
  onToggle: (c: TitleCard) => void
  onClose: () => void
}

export function TitleDetail({ card, snapshot, selected, capped, onToggle, onClose }: TitleDetailProps) {
  const ref = useRef<HTMLElement>(null)
  useDialog(ref, onClose)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce(n => n + 1), [])

  useEffect(() => {
    let alive = true
    setLoad({ kind: 'loading' })
    void (async () => {
      let r = await titleDetail(card.slug, snapshot)
      // 409 snapshot_changed: версия каталога сменилась — берём текущую и просим заново (один раз).
      if (!r.ok && r.status === 409) {
        // Свежая версия — в теле 409; нет — одним ?slugs=.
        const inBody = (r.body as { snapshot?: unknown } | null)?.snapshot
        let next: string | undefined = typeof inBody === 'string' && /^[0-9a-f]{16}$/.test(inBody) ? inBody : undefined
        if (!next) {
          const fresh = await titlesBySlugs([card.slug])
          if (fresh.ok && typeof fresh.data?.snapshot === 'string') next = fresh.data.snapshot
        }
        if (!alive) return
        if (next) r = await titleDetail(card.slug, next)
      }
      if (!alive) return
      if (r.ok && r.data && typeof r.data === 'object' && r.data.item && typeof r.data.item === 'object') setLoad({ kind: 'ready', data: r.data })
      else if (!r.ok && r.status === 404) setLoad({ kind: 'notfound' })
      else setLoad({ kind: 'error' })
    })()
    return () => { alive = false }
  }, [card.slug, snapshot, nonce])

  const item = load.kind === 'ready' ? load.data.item : null
  const head = item ?? card
  const name = head.title_en
  const ruName = head.title_ru && head.title_ru !== head.title_en ? head.title_ru : ''
  const off = (item ? item.goal_ok : card.goal_ok) !== true
  const adult = (head.age_limit ?? 0) >= 18
  const meta = [typeLabel(head.type), head.year ? String(head.year) : ''].filter(Boolean).join(' · ')
  const blocked = (off || capped) && !selected

  return (
    <div className="dt-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} data-testid="detail-scrim">
      <aside className="dt" role="dialog" aria-modal="true" aria-label={ruName || name} ref={ref}>
        <button type="button" className="btn icon sm dt-x" aria-label="Закрыть" onClick={onClose}><CabI.x /></button>
        <div className="dt-head">
          <div className="dt-p"><GoalPoster slug={card.slug} title={ruName || name} hue={(card.slug.length * 47 + 30) % 360} on={false} /></div>
          <div className="dt-hb">
            <h2 className="serif">{name}</h2>
            {ruName && <div className="mute">{ruName}</div>}
            {(meta || adult) && <div className="dt-meta">{meta && <span>{meta}</span>}{adult && <span className="gc-age">18+</span>}</div>}
            {item?.director && (
              <div className="dt-dir"><span className="mono">Режиссёр</span><span>{item.director}</span></div>
            )}
            {head.imdb_id && (
              <a className="gc-more" href={imdbUrl(head.imdb_id)} target="_blank" rel="noopener noreferrer">Открыть на IMDb ↗</a>
            )}
          </div>
        </div>

        {load.kind === 'loading' && <div className="dt-sk" aria-busy="true" data-testid="detail-loading"><i /><i /><i /></div>}
        {load.kind === 'notfound' && <p className="mute dt-na" role="status">{DETAIL_UNAVAILABLE}</p>}
        {load.kind === 'error' && (
          <div className="msg err dt-err" role="alert">
            <CabI.alert /><span>{CATALOG_UNAVAILABLE_TEXT}</span>
            <button type="button" className="btn sm" onClick={retry}>Повторить</button>
          </div>
        )}
        {load.kind === 'ready' && <DetailBody data={load.data} />}

        {load.kind !== 'notfound' && (
          <div className="dt-foot">
            <div className="dt-act">
              <button type="button" className={'btn' + (selected ? ' on' : ' primary')} aria-pressed={selected}
                disabled={blocked} onClick={() => onToggle(card)}>
                {selected ? <><CabI.check />В цели маршрута</> : 'В цель маршрута'}
              </button>
              {off && !selected && <div className="mute dt-note">{TITLE_OFF_TEXT}</div>}
              {!off && capped && !selected && <div className="mute dt-note" role="status">{TOO_MANY_TITLES_TEXT}</div>}
              {head.type === 'series' && <div className="mute dt-note">{FIRST_EPISODE_NOTE}</div>}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

function DetailBody({ data }: { data: TitleDetailResp }) {
  const it = data.item
  const groups = groupsToShow(it.groups)
  const wpm = typeof it.tempo?.wpm === 'number' && it.tempo.wpm > 0 ? it.tempo.wpm : null
  const phrases = it.phrases && typeof it.phrases.n === 'number' && it.phrases.n > 0 ? it.phrases : null
  return (
    <>
      {groups.length > 0 && (
        <section className="dt-sec" aria-label="Слова">
          <div className="dt-sh"><h3>Слова</h3></div>
          <p className="dt-hint">{WORDS_HINT}</p>
          {groups.map(({ group: g, meta }) => {
            const top = Array.isArray(g.top) ? g.top.slice(0, 5).filter(w => w && typeof w.word === 'string') : []
            const share = formatShare(g.share > 0 ? g.share : 0.00001) // у непустой группы «0 %» не бывает: доля округлена шлюзом до нуля
            return (
              <div className="dt-g" key={g.group} data-group={g.group}>
                <div className="dt-gh">
                  <span className="dt-gn">{meta.name}</span>
                  <span className="dt-gr">{meta.range}</span>
                  <span className="dt-gs">{formsLabel(g.forms)}{share && ` · ${share} речи`}</span>
                </div>
                {top.length > 0 && (
                  <div className="dt-words">
                    {top.map(w => <span key={w.word}>{w.word}<i>{formatCount(w.count)}</i></span>)}
                  </div>
                )}
                {top.length > 0 && typeof g.more === 'number' && g.more > 0 && <div className="dt-more">+ ещё {formatCount(g.more)}</div>}
              </div>
            )
          })}
        </section>
      )}

      {wpm !== null && (
        <section className="dt-sec" aria-label="Темп речи">
          <div className="dt-sh"><h3>Темп речи</h3></div>
          <TempoBlock wpm={wpm} source={it.tempo?.source} median={data.tempo_median_wpm} pace={data.pace} />
        </section>
      )}

      {phrases && (
        <section className="dt-sec" aria-label="Полезные обороты">
          <div className="dt-sh"><h3>Полезные обороты</h3></div>
          <div className="dt-big">{formatCount(phrases.n)} <small>{phraseCountLabel(phrases.n)}</small></div>
          {Array.isArray(phrases.top) && phrases.top.length > 0 && (
            <div className="tp-wrap">
              {phrases.top.slice(0, 5).filter(p => p && typeof p.text === 'string').map(p => <span className="chip" key={p.text}>{p.text}</span>)}
            </div>
          )}
        </section>
      )}
    </>
  )
}

function TempoBlock({ wpm, source, median, pace }: { wpm: number; source?: string; median?: number; pace: TitleDetailResp['pace'] }) {
  const est = tempoSourceLabel(source)
  const { m, avg } = paceMarks(wpm, median)
  const word = wpmWord(paceBucket(wpm, pace))
  return (
    <>
      <div className="dt-big">{Math.round(wpm)} <small>слов/мин</small>{est && <small className="dt-est"> · {est}</small>}</div>
      <div className="pace" aria-hidden="true">
        {avg !== null && <span className="pace-avg" style={{ left: `${avg}%` }}><i>в среднем</i></span>}
        <span className="pace-m" style={{ left: `${m}%` }} />
      </div>
      <div className="pace-l"><span>медленно</span><span>{word}</span><span>быстро</span></div>
    </>
  )
}
