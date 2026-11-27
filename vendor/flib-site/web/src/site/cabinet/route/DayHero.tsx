// DayHero.tsx — герой экрана дня (спека 2026-11-17 §4.5, §4.12 «Герой», H3, M1,
// N-C1, OQ-B14; макет «Текущий ролик (hero)»). Герой — ВСЕГДА последний выданный
// ролик (`current_puzzle_id`), «Ролик N из M», кнопки — таблица §4.12 (функция
// heroButtons), «Заменить» при `replace_available` (не у урока слов), оценка во
// всех состояниях. Во время замены — «Подбираем замену…», кнопки оценки и замены
// неактивны. Ролик не с YouTube — карточка «открывается в программе Flibooster».
// Обложка героя-ролика YouTube — настоящее превью i.ytimg.com (решение владельца
// 2026-11-19, README макета), иначе и при ошибке — штриховая заглушка.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CabI } from '../cab-icons'
import type { DayModel } from './day-model'
import { heroButtons, lessonUrl, playerRouteUrl, type HeroAction } from './day-model'
import { canReplaceRow, lessonTitle, minutesOf, newWordsLabel, type DayActions } from './day-actions'
import { RateButtons } from './RateButtons'
import { RowPanel } from './RowPanel'
import type { ExchangePhase } from './exchange-machine'
import { CooldownLine } from './BuildingView'
import { DOWNLOAD_PAGE_PATH } from '../../external-links'

// youtubePreviewUrl — превью ролика YouTube с i.ytimg.com (та же картинка и тот же
// хост, что у карточек примеров в плеере, VideoChatPanel; CSP `img-src` его уже
// разрешает, через BFF ничего не идёт). mqdefault — 320×180, родные 16:9, есть у
// любого публичного ролика (hq/sd — 4:3 с чёрными полосами, maxres бывает не у всех).
// id проверяется по форме ещё раз (BFF уже отдаёт только `youtube::<11>`): адрес
// не строится ни для чего, кроме валидного id.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/
export function youtubePreviewUrl(videoId: string | undefined): string | null {
  if (!videoId || !YT_ID_RE.test(videoId)) return null
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

// HeroPoster — обложка-ссылка героя ролика YouTube. Рамка 16:10 задана CSS
// (`.poster`, aspect-ratio), картинка абсолютная поверх штриховки — сдвига
// раскладки нет ни при загрузке, ни при ошибке. До проверенной загрузки картинка
// прозрачна (`.pending`): штриховка видна, серая заглушка не мелькает.
// ⚠️ Нет превью (ролик удалён/скрыт) — i.ytimg.com отвечает 404 С КАРТИНКОЙ
// (серая 120×90), и ни Chromium, ни Firefox `onerror` НЕ зовут (так по
// спецификации: статус HTTP не важен для декодируемой картинки), поэтому
// после загрузки проверяется ширина: настоящий mqdefault — 320 px, всё уже
// MIN_PREVIEW_WIDTH — заглушка YouTube → штриховка. Исход запоминается ПО id:
// после замены ролика превью нового ролика снова пробуется.
// `key={videoId}` у <img> обязателен: Firefox после смены src дозагружает
// прежнюю картинку и шлёт её `load` на ТОТ ЖЕ элемент (с её naturalWidth) —
// без нового элемента чужое событие решало бы за новый id (картинка прежнего
// ролика под новым героем или потерянное настоящее превью; ревью 2026-11-19 M-1).
const MIN_PREVIEW_WIDTH = 200
type PreviewStatus = { id: string; ok: boolean }
export function HeroPoster({ videoId, watchUrl }: { videoId: string | undefined; watchUrl: string }) {
  const [status, setStatus] = useState<PreviewStatus | null>(null)
  const src = youtubePreviewUrl(videoId)
  const mine = status && status.id === videoId ? status : null
  const showImg = !!src && (!mine || mine.ok)
  const settle = (ok: boolean) => { if (videoId) setStatus({ id: videoId, ok }) }
  return (
    <Link className="poster" to={watchUrl} aria-hidden="true" tabIndex={-1}>
      {showImg && (
        <img
          key={videoId}
          src={src!} alt="" decoding="async" data-testid="hero-preview"
          className={mine?.ok ? undefined : 'pending'}
          onLoad={e => settle(e.currentTarget.naturalWidth >= MIN_PREVIEW_WIDTH)}
          onError={() => settle(false)}
        />
      )}
      <span className="play"><CabI.play /></span>
    </Link>
  )
}

export interface HeroProps {
  model: DayModel
  a: DayActions
  waiting: boolean
  phase: ExchangePhase | null
  fresh: boolean
  flashKey: number
}

export function DayHero({ model, a, waiting, phase, fresh, flashKey }: HeroProps) {
  const c = model.current!
  const pid = c.puzzleId!
  const heard = a.lessonHeard(pid)
  const hb = heroButtons(model, heard)
  const yt = c.clipKind === 'youtube' && !!c.videoId
  const watchUrl = yt ? playerRouteUrl(c.videoId!, pid) : null
  const min = minutesOf(c.durationSec)

  const action = (act: HeroAction | null, primary: boolean) => {
    if (!act) return null
    const cls = 'btn' + (primary ? ' primary' : '')
    switch (act) {
      case 'watch': return watchUrl ? <Link className={cls} to={watchUrl}><CabI.play />Смотреть</Link> : null
      case 'watch_again': return watchUrl ? <Link className={cls} to={watchUrl}><CabI.play />Смотреть снова</Link> : null
      case 'lesson': return <Link className={cls} to={lessonUrl(pid)}>{hb.lessonLabel}</Link>
      case 'next': return <button type="button" className={cls} disabled={a.busy} onClick={a.next}>Следующий ролик</button>
    }
  }

  return (
    <div key={flashKey} className={'hero' + (fresh ? ' fresh' : '')} data-testid="day-hero">
      {/* Оценка — в правом нижнем углу обложки (решение владельца 2026-11-25).
          Кнопки НЕ внутри обложки-ссылки (вложенные интерактивные + aria-hidden),
          поэтому обёртка: обложка и угол — соседи. */}
      <div className="poster-wrap">
        {yt ? (
          <HeroPoster videoId={c.videoId} watchUrl={watchUrl!} />
        ) : (
          <div className="poster static" aria-hidden="true">{c.lesson ? <CabI.check /> : null}</div>
        )}
        <div className="poster-rate"><RateButtons row={c} a={a} where="hero" /></div>
      </div>
      <div className="hero-body">
        <span className="mono" style={{ color: 'var(--accent)' }}>Ролик {c.index} из {model.total}</span>
        <h2>{c.lesson ? lessonTitle(c.words.length || c.newWords) : (c.title || 'Ролик')}</h2>
        <div className="tags">
          {!c.lesson && <span className="tag">{c.source || (c.clipKind === 'youtube' ? 'YouTube' : 'Ролик')}</span>}
          {c.seriesTitle && <span>{c.seriesTitle}</span>}
          {min > 0 && <span>{min} мин</span>}
          {c.newWords > 0 && <span className="words-new">{newWordsLabel(c.newWords)}</span>}
        </div>
        {c.clipKind === 'other' && (
          <div className="msg warn"><span><span>Этот ролик открывается в программе Flibooster</span> <a href={DOWNLOAD_PAGE_PATH}>Скачать Flibooster</a></span></div>
        )}
        {waiting ? (
          <>
            <span className="hero-wait"><span className="spin" />Подбираем замену…</span>
            {phase?.kind === 'cooldown' && <CooldownLine phase={phase} />}
          </>
        ) : null}
        <div className="hero-actions">
          {!waiting && action(hb.primary, true)}
          {!waiting && action(hb.secondary, false)}
          {canReplaceRow(c, a.replaceAvailable) && (
            <button type="button" className="btn" title="Подобрать другой ролик" disabled={a.busy} onClick={() => a.replace(c, 'hero')}><CabI.swap />Заменить</button>
          )}
        </div>
        <RowPanel row={c} a={a} where="hero" />
      </div>
    </div>
  )
}

// StartDayHero — план без выданных роликов (импортированный слепок, R2-L3):
// вместо героя — «Начать день» = обмен `want:"next"`.
export function StartDayHero({ busy, onStart }: { busy: boolean; onStart: () => void }) {
  return (
    <div className="hero" data-testid="day-hero">
      <div className="poster static" aria-hidden="true" />
      <div className="hero-body">
        <span className="mono" style={{ color: 'var(--accent)' }}>Ролики дня</span>
        <h2>День готов</h2>
        <div className="hero-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={onStart}>Начать день</button>
        </div>
      </div>
    </div>
  )
}
