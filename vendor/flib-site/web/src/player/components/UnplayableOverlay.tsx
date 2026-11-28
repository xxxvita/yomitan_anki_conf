// UnplayableOverlay.tsx [ID:P-unplayable] — прод-баг: браузеры с блокировкой
// сторонних куки (Safari/Firefox/мобильные) получают от YouTube анти-бот
// "Sign in to confirm you're not a bot" ВНУТРИ iframe без единого
// IFrame-API-колбэка — наш плеер выглядит мёртвым. Плюс реальные onError-коды
// (100 удалено, 101/150 embedding запрещён) раньше emit'ились в пустоту (0
// подписчиков). См. IFrameAdapter.ts (emit('unplayable', ...)) и
// PlayerAdapter.ts (UnplayablePayload) — этот компонент их единственный
// потребитель.
//
// САМОДОСТАТОЧНЫЙ компонент (тот же минимально-инвазивный паттерн, что
// RouteStepBar/VideoVoteBar): PlayerPage передаёт только videoId + payload
// (что пришло из adapter.on('unplayable')) + onRetry (пересоздать адаптер);
// route_step/навигация/телеметрия — компонент решает и делает сам.
//
// «Пропустить шаг →» переиспользует advanceRouteStep (route-step-nav.ts) —
// тот же переход, что CTA RouteStepBar, вынесенный туда именно ради этого.
//
// Телеметрия: один POST /api/feedback/video verdict='unplayable' за КАЖДОЕ
// новое появление payload (не на каждый ре-рендер) — см. useEffect ниже,
// ключ зависимости [payload] полагается на то, что PlayerPage создаёт НОВЫЙ
// объект payload при каждом emit (adapter.on callback получает свежий
// объект), поэтому смена reason/code (или повторный тот же reason после
// retry — новый инстанс адаптера, новый emit) всегда триггерит эффект
// заново. Ошибки сети глотаем (тот же принцип, что VideoVoteBar).
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { UnplayablePayload } from '../../adapter/PlayerAdapter'
import { ensureAnonId } from '../../site/route-state'
import { advanceRouteStep } from '../route-step-nav'
import './unplayable-overlay.css'

function reportUnplayable(videoId: string, payload: UnplayablePayload): void {
  // Хвост " ff|safari|other" — телеметрия масштаба по браузерам (владелец,
  // 2026-07-14: «это заработает на телефонах?» — узнаем по данным).
  const base = payload.reason === 'embed-error' && payload.code !== undefined
    ? `embed-error:${payload.code}`
    : payload.reason
  const comment = `${base} ${pickBrowserRecipe(navigator.userAgent).browser}`
  fetch('/api/feedback/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anon_id: ensureAnonId(),
      video_id: videoId,
      verdict: 'unplayable',
      comment,
    }),
  }).then(res => {
    if (!res.ok) console.warn('[unplayable] telemetry non-ok response', res.status)
  }).catch(err => {
    console.warn('[unplayable] telemetry failed', err)
  })
}

// embedErrorCopy — текст по onError-коду:
// 100 = видео удалено/скрыто (открывать в YouTube бессмысленно — там тоже
// не будет работать, только «Пропустить шаг»); прочие коды (2 — bad videoId,
// 5 — HTML5-плеер) — общий текст с «Открыть в YouTube».
//
// ⚠ 101/150 сюда НЕ попадают — прод-факт 2026-07-14 (скрин владельца,
// Firefox): YouTube отдаёт 150 и для браузеров БЕЗ YouTube-сессии
// (заблокированные сторонние куки) — то же видео в Chrome играет, т.е.
// «владелец запретил встраивание» было враньём. Отличить настоящий запрет
// владельца от кукис-отказа по коду НЕЛЬЗЯ → 101/150 показывают botwall-
// вариант оверлея (вход на youtube.com → «Попробовать снова» лечит
// кукис-случай; для настоящего запрета остаётся «Открыть в YouTube»).
function embedErrorCopy(code: number | undefined): { text: string; offerOpenInYouTube: boolean } {
  if (code === 100) return { text: 'Видео недоступно (удалено или скрыто)', offerOpenInYouTube: false }
  return { text: 'Не удалось воспроизвести видео', offerOpenInYouTube: true }
}

// pickBrowserRecipe — браузер-специфичный рецепт для бот-стены. ПРОВЕРЕНО
// ВЛАДЕЛЬЦЕМ (2026-07-14, Firefox desktop): выключение щитка ETP для сайта
// заводит видео мгновенно — Firefox партиционирует куки (Total Cookie
// Protection), «войди в новой вкладке» там НЕ помогает вообще. Firefox
// Android — тот же щиток. Safari — Storage Access prompt после входа на
// youtube.com либо глобальный тумблер в настройках. Прочие — generic вход.
// Экспорт — для юнит-тестов (UA-матрица).
export function pickBrowserRecipe(ua: string): { browser: string; lines: string[] } {
  if (/firefox/i.test(ua)) {
    return {
      browser: 'firefox',
      lines: [
        'В Firefox: нажмите на щиток 🛡 слева от адреса и выключите защиту для этого сайта.',
        'Затем нажмите «Попробовать снова» — видео заработает.',
      ],
    }
  }
  if (/safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua)) {
    return {
      browser: 'safari',
      lines: [
        'Откройте youtube.com в новой вкладке и войдите в аккаунт, затем вернитесь и нажмите «Попробовать снова» — разрешите доступ, если Safari спросит.',
        'Не помогло — выключите «Предотвращение перекрёстного отслеживания» в Настройках Safari, или откройте видео в приложении YouTube.',
      ],
    }
  }
  return {
    browser: 'other',
    lines: [
      'Чаще всего помогает вход: откройте youtube.com в новой вкладке, войдите в аккаунт, вернитесь и нажмите «Попробовать снова».',
      'Или откройте видео в приложении YouTube.',
    ],
  }
}

// isBotwallLike — 101/150 неотличимы от кукис-отказа (см. embedErrorCopy) —
// лечим как botwall: у пользователя с настоящим «запретом владельца» просто
// не поможет «Попробовать снова», остальные кнопки те же. Вынесено из
// компонента — нужно И рендеру, И probe-эффекту ниже (см. doc [ID:P-hybrid]).
function isBotwallLike(payload: UnplayablePayload): boolean {
  return payload.reason === 'botwall-suspect'
    || (payload.reason === 'embed-error' && (payload.code === 101 || payload.code === 150))
}

export function UnplayableOverlay({ videoId, payload, onRetry, onSwitchToNative, onSwitchToIframe }: {
  videoId: string
  payload: UnplayablePayload | null
  onRetry: () => void
  // onSwitchToNative [ID:P-hybrid] — ДЕШЁВЫЙ ВРЕМЕННЫЙ гибрид: переключить
  // транспорт на NativeVideoAdapter (см. PlayerPage.tsx). Опционален — тесты
  // и любой будущий вызывающий, которому fallback не нужен, просто не дают
  // проп, кнопка тогда не рендерится вовсе (см. рендер ниже) и НИ ОДНОГО
  // лишнего сетевого зонда не уходит — самый дешёвый способ выключить кусок
  // функциональности без if-веток по всему компоненту.
  onSwitchToNative?: () => void
  // onSwitchToIframe (аудит MED-3/5b [ID:P-hybrid-audit]) — обратный путь из
  // native-error: без него native залипал на всю сессию (sessionStorage
  // 'flib:transport' переживает remount/шаги маршрута, а сломавшийся
  // native-транспорт не оставлял пользователю НИКАКОЙ кнопки назад). Тот же
  // опциональный паттерн, что onSwitchToNative — PlayerPage даёт его только
  // на native-транспорте (симметрично).
  onSwitchToIframe?: () => void
}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const routeStepId = params.get('route_step')
  const [dismissed, setDismissed] = useState(false)
  // nativeProbe [ID:P-hybrid]: 'unknown' до зонда/пока зонд не нужен;
  // 'available' — GET /api/video/{id} НЕ вернул 404 (фича включена на бэке,
  // см. video_proxy.go VideoProxyHandler) → кнопка fallback имеет смысл;
  // 'unavailable' — 404 (флаг выключен) ИЛИ сеть легла — кнопки нет.
  const [nativeProbe, setNativeProbe] = useState<'unknown' | 'available' | 'unavailable'>('unknown')
  // probedForRef — зонд СТРОГО один раз на videoId (владелец задачи: "зонд
  // делать лениво при показе оверлея, один раз") — повторные emit'ы того же
  // unplayable (например, после нескольких botwall-подозрений подряд) не
  // должны бомбить бэк повторными GET /api/video/{id} (та ручка САМА
  // достаточно дорога — 202 триггерит фоновое скачивание, см. video_proxy.go).
  const probedForRef = useRef<string | null>(null)

  // Новое событие (новый payload-объект — новый emit, включая после retry,
  // см. doc выше) — сбрасываем ручное "✕ скрыть" и шлём телеметрию РОВНО
  // один раз на это появление.
  useEffect(() => {
    setDismissed(false)
    if (!payload || !videoId) return
    reportUnplayable(videoId, payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // [ID:P-hybrid] Ленивый зонд доступности fallback-транспорта — ТОЛЬКО если
  // (a) вызывающий вообще дал onSwitchToNative (иначе зонд бессмыслен, см.
  // doc пропа выше) и (b) это botwall-ветка (единственное место, где кнопка
  // вообще может появиться, см. рендер ниже). Хард-фейлы (embed-error код
  // 100/2/5, "видео правда недоступно") НИКОГДА не зондируют — свой прокси
  // тянет тот же YouTube-источник тем же yt-dlp, повторит ту же ошибку.
  //
  // ?probe=1 (аудит MED-2 [ID:P-hybrid-audit]) — read-only режим ручки
  // (internal/bff/video_proxy.go): отвечает состоянием
  // {"status":"cached"|"warming"|"cold"} и НИКОГДА не запускает скачивание.
  // Без probe сам ПОКАЗ стены триггерил прогрев на gateway (egress-
  // амплификация: каждая стена = скачивание видео, которое юзер, возможно, и
  // не попросит). Настоящий прогрев начинается только по КЛИКУ по кнопке —
  // NativeVideoAdapter дёргает тот же URL уже БЕЗ probe.
  useEffect(() => {
    if (!payload || !videoId || !onSwitchToNative) return
    if (!isBotwallLike(payload)) return
    if (probedForRef.current === videoId) return
    probedForRef.current = videoId
    fetch(`/api/video/${encodeURIComponent(videoId)}?probe=1`)
      .then(res => setNativeProbe(res.status === 404 ? 'unavailable' : 'available'))
      .catch(() => setNativeProbe('unavailable'))
  }, [payload, videoId, onSwitchToNative])

  if (!payload || !videoId || dismissed) return null

  const youtubeUrl = `https://youtu.be/${videoId}`

  function handleSkip() {
    if (routeStepId) advanceRouteStep(routeStepId, navigate)
  }

  const skipBtn = routeStepId && (
    <button type="button" className="upo-btn upo-btn-secondary" onClick={handleSkip}>
      Пропустить шаг →
    </button>
  )

  const botwallLike = isBotwallLike(payload)

  // [ID:P-hybrid] «Смотреть через flib-плеер (бета)» — ТОЛЬКО botwall-ветка
  // (владелец задачи п.2b: "кнопка в botwall-ветке"), ТОЛЬКО когда зонд
  // подтвердил, что fallback реально доступен, и ТОЛЬКО если вызывающий дал
  // onSwitchToNative. Пока зонд ещё не отработал ('unknown') кнопки тоже нет —
  // не показываем действие, которое прямо сейчас может 404-нуть.
  const switchToNativeBtn = botwallLike && nativeProbe === 'available' && onSwitchToNative && (
    <button type="button" className="upo-btn upo-btn-secondary" onClick={onSwitchToNative}>
      Смотреть через flib-плеер (бета)
    </button>
  )

  // reason === 'native-error' [ID:P-hybrid]: Track B (уже выбранный
  // native-транспорт) сам сломался. Пути назад: retry (remount пересоздаёт
  // адаптер ТЕКУЩЕГО транспорта), «Пропустить шаг» и — аудит MED-3/5b
  // [ID:P-hybrid-audit] — «Вернуться на YouTube-плеер» (onSwitchToIframe:
  // сбрасывает sessionStorage-выбор + remount на iframe). Кнопка возврата
  // нужна ОБЯЗАТЕЛЬНО: sessionStorage-персистентность иначе залипала native
  // на все шаги маршрута до конца сессии, а native-error может означать и
  // «фичу выключили флагом посреди сессии» — тогда iframe единственный
  // рабочий транспорт (и бот-стена там могла тем временем уйти: юзер
  // залогинился/выключил щиток по рецепту).
  if (payload.reason === 'native-error') {
    return (
      <div className="unplayable-overlay" data-testid="unplayable-overlay" role="alert">
        <div className="upo-panel">
          <div className="upo-title">Не удалось воспроизвести видео через flib-плеер</div>
          <div className="upo-actions">
            <button type="button" className="upo-btn upo-btn-primary" onClick={onRetry}>
              Попробовать снова
            </button>
            {onSwitchToIframe && (
              <button type="button" className="upo-btn upo-btn-secondary" onClick={onSwitchToIframe}>
                Вернуться на YouTube-плеер
              </button>
            )}
            {skipBtn}
          </div>
        </div>
      </div>
    )
  }

  if (botwallLike) {
    const recipe = pickBrowserRecipe(navigator.userAgent)
    return (
      <div className="unplayable-overlay" data-testid="unplayable-overlay" role="alert">
        <div className="upo-panel">
          <button type="button" className="upo-dismiss" aria-label="скрыть" onClick={() => setDismissed(true)}>
            ✕ скрыть
          </button>
          <div className="upo-title">YouTube не даёт воспроизвести видео в этом браузере</div>
          <p className="upo-explain">
            {recipe.lines.map((line, i) => (
              <span key={i}>{i > 0 && <br />}{line}</span>
            ))}
          </p>
          <div className="upo-actions">
            <a className="upo-btn" href="https://youtube.com" target="_blank" rel="noopener noreferrer">
              Открыть youtube.com ↗
            </a>
            <button type="button" className="upo-btn upo-btn-primary" onClick={onRetry}>
              Попробовать снова
            </button>
            <a className="upo-btn" href={youtubeUrl} target="_blank" rel="noopener noreferrer">
              Открыть в YouTube ↗
            </a>
            {switchToNativeBtn}
            {skipBtn}
          </div>
        </div>
      </div>
    )
  }

  // reason === 'embed-error' (единственное, что осталось — native-error и
  // botwallLike уже вернули выше). payload.code читаем через явную проверку
  // reason, а не полагаемся на TS-сужение по isBotwallLike (это ОБЫЧНАЯ
  // функция, не user-defined type guard — TS не сужает union через неё).
  const { text, offerOpenInYouTube } = embedErrorCopy(payload.reason === 'embed-error' ? payload.code : undefined)
  return (
    <div className="unplayable-overlay" data-testid="unplayable-overlay" role="alert">
      <div className="upo-panel">
        <div className="upo-title">{text}</div>
        <div className="upo-actions">
          {offerOpenInYouTube && (
            <a className="upo-btn" href={youtubeUrl} target="_blank" rel="noopener noreferrer">
              Открыть в YouTube ↗
            </a>
          )}
          {skipBtn}
        </div>
      </div>
    </div>
  )
}
