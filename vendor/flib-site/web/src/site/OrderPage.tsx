// OrderPage.tsx — /order/:id, страница заказа. Сюда ЮKassa возвращает
// покупателя после оплаты (return_url шлюза = <сайт>/order/<id>).
//
// Доступ к заказу даёт HttpOnly-cookie с токеном, которую BFF поставил при
// создании заказа: в другом браузере её нет, и BFF отвечает 401
// order_token_missing. Ключ после «Показать ключ» живёт только в состоянии
// компонента — не в URL и не в хранилищах браузера.
//
// Опрос: раз в 3 с первые 2 минуты, дальше раз в 15 с; во вкладке в фоне
// пауза, при возврате — сразу запрос; в конечных состояниях опрос стоит.
// canceled конечным не считается: шлюз допускает canceled → paid (ЮKassa
// подтвердила оплату позже), поэтому ещё 30 минут — раз в 15 с.
//
// Почта после оплаты: contact_status = deferred (шлюз не смог сохранить
// почту при заказе) — форма «Оставьте почту» → POST …/contact. ok, none, нет
// поля, отменённый/возвращённый заказ и отказ vault_disabled/contact_not_allowed
// — формы нет. Почта живёт только в состоянии компонента.
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import {
  emailsReady, fetchOrder, formatKeyExpiry, formatRub, isOrderId, isTgLink, parseKeyExpiry, revealKey, submitContact, waitLabel,
  type ContactResult, type Order, type OrderStatus, type RevealResult,
} from './billing-api'
import { EMAIL_INVALID_TEXT, EMAIL_REQUIRED_TEXT, EmailFields } from './EmailFields'
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL } from './external-links'
import { plural } from './plural'

const FAST_MS = 3_000
const SLOW_MS = 15_000
const FAST_WINDOW_MS = 120_000
const CANCELED_WATCH_MS = 30 * 60_000
// paid дольше этого — выдача застряла, показываем контакты поддержки.
const PAID_STUCK_MS = 5 * 60_000
// Дальше статус сам не меняется (возврат после выдачи — редкость, его покажет
// перезагрузка страницы).
const TERMINAL: ReadonlySet<OrderStatus> = new Set(['fulfilled', 'refunded', 'partially_refunded'])

// Перечитывание заказа вне опроса (после показа ключа, при возврате во
// вкладку). Чтение заказа и показ ключа идут через ОДИН гейт BFF — 250 мс на
// адрес (internal/bff/billing.go, billingOrderMinGap): запрос раньше получил
// бы 429. Поэтому пауза от последнего ответа по заказу — 400 мс с запасом.
const REFRESH_MIN_GAP_MS = 400
// Повторы при 429/сбое; Retry-After из ответа важнее, но не дольше минуты.
const REFRESH_BACKOFF_MS = [1_000, 2_000, 4_000]
const REFRESH_MAX_WAIT_MS = 60_000
// reveal на 429 повторяется сам, только если ждать недолго: это гейт BFF
// (Retry-After 1 с) или занятость (без Retry-After). Минуты — лимит шлюза.
const REVEAL_AUTO_RETRY_MAX_SEC = 2

const SUPPORT_EMAIL = 'help@flib.club'

type Fatal = 'token_missing' | 'not_found' | null
type RevealState = 'idle' | 'loading' | 'issued' | 'not_ready' | 'rate_limited' | 'error'
// Форма почты: idle/sending — по contact_status заказа; saved — почта у
// шлюза (ok или contact_already_set); hidden — шлюз сказал больше не просить.
type ContactState = 'idle' | 'sending' | 'saved' | 'hidden'

// Заказ, по которому почту уже не принять (шлюз ответил бы contact_not_allowed).
const CONTACT_CLOSED: ReadonlySet<OrderStatus> = new Set(['canceled', 'refunded', 'partially_refunded'])

function contactFailMessage(r: Exclude<ContactResult, { kind: 'ok' | 'already_set' | 'not_allowed' }>): string {
  switch (r.kind) {
    case 'email_invalid': return EMAIL_INVALID_TEXT
    case 'email_required': return EMAIL_REQUIRED_TEXT
    case 'unavailable':
      return r.retryAfterSec
        ? `Не удалось сохранить почту. Попробуйте через ${waitLabel(r.retryAfterSec)}.`
        : 'Не удалось сохранить почту. Попробуйте чуть позже.'
    case 'rate_limited':
      return r.retryAfterSec
        ? `Слишком много попыток. Попробуйте через ${waitLabel(r.retryAfterSec)}.`
        : 'Слишком много попыток. Попробуйте чуть позже.'
    case 'timeout': return 'Сервер долго не отвечает. Проверьте соединение и попробуйте ещё раз.'
    default: return 'Не удалось сохранить почту. Попробуйте ещё раз.'
  }
}

function SupportContacts() {
  return (
    <p className="soft billing-support">
      Поддержка: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> или Telegram-бот{' '}
      <a href={SUPPORT_BOT_URL} target="_blank" rel="noopener noreferrer">@{SUPPORT_BOT_HANDLE}</a>
    </p>
  )
}

// Внешние ссылки из ответа (оплата, чек) — только https: javascript:/data:
// в href не попадут, даже если ответ окажется битым.
function safeHttps(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null
}

// Бесплатный заказ (промокод на 0 ₽) ждёт выдачи ключа, а не оплаты. Только
// строгое 0: отсутствие суммы бесплатным не считается.
function isFree(o: Order): boolean {
  return o.amount_kopecks === 0
}
function isFreePreparing(o: Order): boolean {
  return isFree(o) && (o.status === 'created' || o.status === 'pending')
}

function timeLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

// OrderRoute — маршрут /order/:id. key={id}: при переходе на другой заказ
// страница монтируется заново, и состояние прежнего (в том числе показанный
// ключ) не переезжает.
export function OrderRoute() {
  const { id } = useParams()
  return <OrderPage key={id} />
}

export function OrderPage() {
  const { id } = useParams()
  const validId = isOrderId(id)
  const [order, setOrder] = useState<Order | null>(null)
  const [fatal, setFatal] = useState<Fatal>(validId ? null : 'not_found')
  const [pollError, setPollError] = useState(false)
  const [key, setKey] = useState<{ value: string; revealUntil: string } | null>(null)
  const [reveal, setReveal] = useState<RevealState>('idle')
  const [retryAfter, setRetryAfter] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  // Когда страница впервые увидела paid (часы браузера, а не paid_at шлюза:
  // их часы могут расходиться).
  const [paidSeenAt, setPaidSeenAt] = useState<number | null>(null)
  // Перечитывание заказа вне опроса (refreshOrder): таймер ожидания и
  // запрос в полёте. При уходе со страницы снимаются оба.
  const refresh = useRef<{ timer: ReturnType<typeof setTimeout> | null; ctl: AbortController | null }>({ timer: null, ctl: null })
  // Последнее событие по заказу (отправка запроса или ответ — чтение или
  // показ ключа): от него отсчитывается REFRESH_MIN_GAP_MS.
  const lastOrderReqAt = useRef(0)
  // Страница ушла: ответ reveal, пришедший позже, не должен заводить
  // перечитывание (cleanup уже отработал, таймер некому было бы снять).
  const unmounted = useRef(false)
  // Идёт показ ключа (пауза перед reveal или reveal в полёте): возврат во
  // вкладку заказ не читает — ответ reveal сам заведёт перечитывание.
  const revealBusy = useRef(false)
  const tgShown = order !== null && isTgLink(order.tg_link_url)
  const [contactEmail, setContactEmail] = useState('')
  const [contactConfirm, setContactConfirm] = useState('')
  const [contactError, setContactError] = useState<string | null>(null)
  const [contactState, setContactState] = useState<ContactState>('idle')
  // Синхронная защита от двойного клика (как inFlight на /buy).
  const contactBusy = useRef(false)

  useEffect(() => { window.scrollTo(0, 0) }, [])
  // Сброс при монтировании: StrictMode (main.tsx) в разработке прогоняет
  // эффекты дважды — mount, cleanup, mount, и флаг иначе застрял бы в true.
  useEffect(() => {
    unmounted.current = false
    return () => { unmounted.current = true; cancelRefresh() }
  }, [])

  // Пока кнопка Telegram на экране, возврат во вкладку перечитывает заказ:
  // пользователь мог привязать ключ (ссылка использована) или окно показа
  // закрылось — тогда шлюз поле не пришлёт, и кнопка исчезнет. Уже
  // заведённое или летящее перечитывание возврат не перезапускает.
  useEffect(() => {
    if (!tgShown) return
    const onVisible = () => { if (!document.hidden && !revealBusy.current) refreshOrder(false) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // refreshOrder читает только ref'ы и id, а id на время жизни страницы
    // неизменен (OrderRoute монтирует её заново по key={id}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgShown])

  useEffect(() => {
    if (!isOrderId(id)) return
    const orderId = id
    let stopped = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let ctl: AbortController | null = null
    const start = Date.now()
    let canceledSince: number | null = null

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null }
    }
    const schedule = () => {
      if (stopped || document.hidden) return
      const fast = canceledSince === null && Date.now() - start < FAST_WINDOW_MS
      timer = setTimeout(tick, fast ? FAST_MS : SLOW_MS)
    }
    async function tick() {
      timer = null
      if (stopped || inFlight) return
      inFlight = true
      ctl = new AbortController()
      lastOrderReqAt.current = Date.now()
      const r = await fetchOrder(orderId, ctl.signal)
      inFlight = false
      lastOrderReqAt.current = Date.now()
      if (stopped) return
      switch (r.kind) {
        case 'ok': {
          const now = Date.now()
          setOrder(r.order)
          setPollError(false)
          if (r.order.status === 'paid' || isFreePreparing(r.order)) setPaidSeenAt(prev => prev ?? now)
          if (TERMINAL.has(r.order.status)) { stopped = true; return }
          if (r.order.status === 'canceled') {
            canceledSince ??= now
            if (now - canceledSince >= CANCELED_WATCH_MS) { stopped = true; return }
          } else {
            canceledSince = null
          }
          break
        }
        case 'token_missing':
        case 'not_found':
          setFatal(r.kind)
          stopped = true
          return
        case 'rate_limited':
          // Тихо ждём следующего тика: лимит шлюза — на минуту.
          break
        default:
          setPollError(true)
      }
      schedule()
    }
    const onVisibility = () => {
      clearTimer()
      if (!document.hidden && !stopped) void tick()
    }

    document.addEventListener('visibilitychange', onVisibility)
    void tick()
    return () => {
      stopped = true
      clearTimer()
      ctl?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id])

  // Остаток паузы REFRESH_MIN_GAP_MS от последнего события по заказу; не
  // больше самой паузы — на случай часов, ушедших назад.
  function gapLeft(): number {
    return Math.max(0, Math.min(lastOrderReqAt.current + REFRESH_MIN_GAP_MS - Date.now(), REFRESH_MIN_GAP_MS))
  }

  // revealAfter — reveal через ms; null — страница ушла (до или во время).
  async function revealAfter(orderId: string, ms: number): Promise<RevealResult | null> {
    if (ms > 0) await new Promise<void>(res => { setTimeout(res, ms) })
    if (unmounted.current) return null
    lastOrderReqAt.current = Date.now()
    const r = await revealKey(orderId)
    lastOrderReqAt.current = Date.now()
    return unmounted.current ? null : r
  }

  // showKey — reveal делит гейт BFF с чтением заказа, поэтому сначала
  // выдерживается остаток паузы (кнопка всё это время в состоянии загрузки),
  // а перечитывание снимается — ответ reveal заведёт его заново. На 429
  // гейта (Retry-After не больше 2 с или его нет) — один повтор: внутри окна
  // показа reveal идемпотентен. Долгий Retry-After — лимит шлюза, его
  // показываем.
  async function showKey() {
    if (!validId || reveal === 'loading' || revealBusy.current) return
    setReveal('loading')
    revealBusy.current = true
    cancelRefresh()
    let r: RevealResult | null
    try {
      r = await revealAfter(id, gapLeft())
      if (r?.kind === 'rate_limited' && (r.retryAfterSec ?? 0) <= REVEAL_AUTO_RETRY_MAX_SEC) {
        r = await revealAfter(id, Math.max((r.retryAfterSec ?? 0) * 1000, REFRESH_MIN_GAP_MS))
      }
    } finally {
      revealBusy.current = false
    }
    if (r === null) return
    switch (r.kind) {
      case 'ok':
        setKey({ value: r.key, revealUntil: r.revealUntil })
        setReveal('idle')
        // Ссылку привязки Telegram шлюз отдаёт только после первого показа
        // ключа, а опрос на fulfilled уже стоит.
        refreshOrder(true)
        return
      case 'already_issued':
        setReveal('issued')
        // Вкладка могла быть открыта до перевыпуска ключа поддержкой:
        // перечитанный заказ с key_replaced покажет «заменён».
        refreshOrder(true)
        return
      case 'not_ready': setReveal('not_ready'); return
      case 'rate_limited': setRetryAfter(r.retryAfterSec); setReveal('rate_limited'); return
      case 'token_missing':
      case 'not_found':
        setFatal(r.kind)
        return
      default: setReveal('error')
    }
  }

  function cancelRefresh() {
    const s = refresh.current
    if (s.timer) { clearTimeout(s.timer); s.timer = null }
    s.ctl?.abort()
    s.ctl = null
  }

  // refreshOrder — прочитать заказ один раз вне опроса, не раньше
  // REFRESH_MIN_GAP_MS после последнего запроса или ответа по заказу. На 429
  // и сбой — до трёх повторов (Retry-After, иначе 1, 2, 4 с); потом молча
  // сдаёмся: ключ уже на экране, без кнопки Telegram страница остаётся
  // рабочей. restart=true (после показа ключа) заменяет прежнее
  // перечитывание — выдержка считается и от отменённой отправки; false
  // (возврат во вкладку) не трогает уже заведённое или летящее.
  function refreshOrder(restart: boolean) {
    if (!validId || unmounted.current) return
    if (!restart && (refresh.current.timer || refresh.current.ctl)) return
    const orderId = id
    cancelRefresh()
    let retries = 0
    const later = (ms: number) => {
      if (unmounted.current) return
      refresh.current.timer = setTimeout(() => { void attempt() }, Math.max(ms, gapLeft()))
    }
    async function attempt() {
      refresh.current.timer = null
      if (unmounted.current) return
      const ctl = new AbortController()
      refresh.current.ctl = ctl
      lastOrderReqAt.current = Date.now()
      const r = await fetchOrder(orderId, ctl.signal)
      if (ctl.signal.aborted || unmounted.current) return
      refresh.current.ctl = null
      lastOrderReqAt.current = Date.now()
      if (r.kind === 'ok') {
        setOrder(r.order)
        // Ключ перевыпущен поддержкой: показанная строка мертва, из состояния
        // её убираем, чтобы никакой следующий ответ не вернул её на экран.
        // Опросу это не нужно: key_replaced бывает только у fulfilled, а на
        // нём опрос останавливается до показа ключа.
        if (r.order.key_replaced === true) setKey(null)
        return
      }
      if ((r.kind !== 'rate_limited' && r.kind !== 'error') || retries >= REFRESH_BACKOFF_MS.length) return
      const fromServer = r.kind === 'rate_limited' && r.retryAfterSec ? Math.min(r.retryAfterSec * 1000, REFRESH_MAX_WAIT_MS) : 0
      later(fromServer || REFRESH_BACKOFF_MS[retries])
      retries++
    }
    later(0)
  }

  // contactAfter — POST …/contact через ms; null — страница ушла.
  async function contactAfter(orderId: string, email: string, ms: number): Promise<ContactResult | null> {
    if (ms > 0) await new Promise<void>(res => { setTimeout(res, ms) })
    if (unmounted.current) return null
    lastOrderReqAt.current = Date.now()
    const r = await submitContact(orderId, email)
    lastOrderReqAt.current = Date.now()
    return unmounted.current ? null : r
  }

  // saveContact — почта после оплаты. Ручка делит гейт BFF с чтением заказа
  // и показом ключа, поэтому, как и reveal, выдерживает паузу от последнего
  // запроса по заказу и один раз повторяет на коротком 429 гейта.
  async function saveContact() {
    if (!validId || contactBusy.current || !emailsReady(contactEmail, contactConfirm)) return
    contactBusy.current = true
    setContactState('sending')
    setContactError(null)
    const email = contactEmail.trim()
    let r: ContactResult | null
    try {
      r = await contactAfter(id, email, gapLeft())
      if (r?.kind === 'rate_limited' && (r.retryAfterSec ?? 0) <= REVEAL_AUTO_RETRY_MAX_SEC) {
        r = await contactAfter(id, email, Math.max((r.retryAfterSec ?? 0) * 1000, REFRESH_MIN_GAP_MS))
      }
    } finally {
      contactBusy.current = false
    }
    if (r === null) return
    switch (r.kind) {
      case 'ok':
      case 'already_set':
        setContactState('saved')
        return
      case 'not_allowed':
        setContactState('hidden')
        return
      // 401/404 от …/contact не роняют страницу: ключ уже может быть на
      // экране, а отказ касается только почты — сообщение у формы.
      default:
        setContactState('idle')
        setContactError(contactFailMessage(r))
    }
  }

  function onContactChange(set: (v: string) => void, value: string) {
    set(value)
    setContactError(null)
  }

  async function copyKey() {
    if (!key) return
    try {
      await navigator.clipboard.writeText(key.value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow billing-page">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/">← на главную</Link>
          </div>
          <div className="billing-order">{renderBody()}</div>
        </div>
      </div>
    </div>
  )

  function renderBody() {
    if (fatal === 'token_missing') {
      return (
        <>
          <h1>Заказ открыт в другом браузере</h1>
          <p className="soft">
            Откройте эту страницу в том же браузере, где оформляли заказ. Если это невозможно — напишите нам,
            укажите адрес этой страницы.
          </p>
          <SupportContacts />
        </>
      )
    }
    if (fatal === 'not_found') {
      return (
        <>
          <h1>Заказ не найден</h1>
          <p className="soft">Проверьте ссылку. Если Вы оплатили заказ, напишите нам.</p>
          <SupportContacts />
        </>
      )
    }
    if (!order) {
      return pollError
        ? <p className="billing-msg billing-msg-bad" role="alert">Не удалось проверить заказ, обновите страницу.</p>
        : <p className="soft">Проверяем заказ…</p>
    }
    return (
      <>
        {renderStatus(order)}
        {renderTgLink(order)}
        {renderContact(order)}
        <p className="soft billing-summary">{order.product_title} · {formatRub(order.amount_kopecks)}</p>
        {renderReceipt(order)}
        {pollError && (
          <p className="billing-msg billing-msg-warn" role="alert">Не удалось проверить заказ, обновите страницу.</p>
        )}
      </>
    )
  }

  // Заказ по ссылке продления, закрытый шлюзом без продления: дубль оплаты
  // той же ссылки или ключ, который уже нельзя продлить. null — обычный заказ.
  function renderRefundReason(o: Order) {
    const closed = o.status === 'refunded' || o.status === 'partially_refunded' || o.status === 'canceled' || o.status === 'paid'
    if (!closed) return null
    if (o.refund_reason === 'duplicate') {
      // canceled — второй заказ по ссылке был бесплатным, платежа нет.
      return (
        <>
          <h1>{o.status === 'canceled' ? 'Эта ссылка уже использована' : 'Эта ссылка уже оплачена, деньги вернутся на карту'}</h1>
          {o.status !== 'canceled' && <SupportContacts />}
        </>
      )
    }
    if (o.refund_reason === 'key_unavailable' && o.status === 'canceled') {
      // Бесплатное продление, закрытое шлюзом: платежа не было — про деньги ни слова.
      return <h1>Этот ключ больше нельзя продлить</h1>
    }
    if (o.refund_reason === 'key_unavailable') {
      return (
        <>
          <h1>Этот ключ больше нельзя продлить, деньги вернутся на карту</h1>
          <SupportContacts />
        </>
      )
    }
    return null
  }

  function renderStatus(o: Order) {
    const reason = renderRefundReason(o)
    if (reason) return reason
    switch (o.status) {
      case 'created':
      case 'pending':
        if (isFree(o)) return renderPreparing('Готовим ключ…')
        return (
          <>
            <h1>Ждём оплату</h1>
            <p className="soft">Если Вы уже оплатили, страница обновится сама.</p>
            {safeHttps(o.confirmation_url) && (
              <a className="btn btn-amber btn-lg" href={safeHttps(o.confirmation_url)!} rel="noreferrer">Перейти к оплате</a>
            )}
          </>
        )
      case 'paid':
        return renderPreparing(isFree(o) ? 'Готовим ключ…' : 'Оплата прошла, готовим ключ')
      case 'fulfilled':
        return renderFulfilled(o)
      case 'canceled':
        return (
          <>
            <h1>Оплата не прошла</h1>
            <p className="soft">Деньги не списаны. Можно оформить заказ заново.</p>
            <Link className="btn btn-amber" to="/buy">Попробовать снова</Link>
          </>
        )
      case 'refunded':
      case 'partially_refunded':
        return (
          <>
            <h1>Деньги возвращены, ключ отключён</h1>
            <SupportContacts />
          </>
        )
      default:
        return <p className="soft">Проверяем заказ…</p>
    }
  }

  function renderPreparing(title: string) {
    return (
      <>
        <h1>{title}</h1>
        <p className="soft">Обычно это занимает несколько секунд. Страница обновится сама.</p>
        {paidSeenAt !== null && Date.now() - paidSeenAt > PAID_STUCK_MS && (
          <>
            <p className="billing-msg billing-msg-warn">Ключ готовится дольше обычного. Если он не появится, напишите нам.</p>
            <SupportContacts />
          </>
        )}
      </>
    )
  }

  function renderFulfilled(o: Order) {
    // Ключ заказа перевыпущен поддержкой (key_replaced, шлюз 0.41.0): прежняя
    // строка не работает, новую человек получил по ссылке от поддержки. Это
    // не ошибка: key_purged и 410 при этом ожидаемы, показ ключа не
    // предлагаем. Текст — дословно решение владельца.
    if (o.key_replaced === true) {
      return (
        <p className="soft">
          Ключ этого заказа заменён поддержкой. Новый ключ выдан по Вашему обращению; если это были не Вы — напишите в{' '}
          <a href={SUPPORT_BOT_URL} target="_blank" rel="noopener noreferrer">@{SUPPORT_BOT_HANDLE}</a>
        </p>
      )
    }
    if (key) {
      const until = timeLabel(key.revealUntil)
      return (
        <>
          <h1>Ваш ключ</h1>
          <div className="billing-key mono" data-testid="billing-key">{key.value}</div>
          <button type="button" className="btn btn-amber" onClick={copyKey}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
          <p className="billing-msg billing-msg-warn">
            Сохраните ключ: после закрытия окна показать его снова можно {until ? `до ${until}` : 'в течение 15 минут'},
            дальше — только через поддержку.
          </p>
          <p className="soft">Вставьте ключ в приложение Flibooster или в окно входа на сайте.</p>
        </>
      )
    }
    // Итог заказа по kind (если продлеваемый ключ исчез к оплате, шлюз выдаёт
    // новый: kind=new). Старый шлюз kind и key_purged не шлёт — ниже запасной
    // вывод по key_ready/key_revealed.
    if (o.kind === 'renewal') {
      const days = `${o.duration_days} ${plural(o.duration_days, 'день', 'дня', 'дней')}`
      // Текущий срок ключа (key_expires_at, решение владельца 2026-11-17) —
      // во времени устройства покупателя. Нет поля (старый шлюз, бессрочный
      // или отозванный ключ, непарсящееся значение) — прежний текст.
      const expires = parseKeyExpiry(o.key_expires_at)
      if (expires !== null) {
        return (
          <>
            {/* Бесплатный заказ — без слов об оплате (правило владельца, PR #76). */}
            <h1>{isFree(o) ? `Ключ продлён на ${days}.` : `Оплата прошла, ключ продлён на ${days}.`}</h1>
            {/* Срок уже в прошлом по часам устройства в момент показа
                (решение владельца 2026-11-17) — «истёк» и ссылка на продление. */}
            {expires <= Date.now() ? (
              <>
                <p className="soft">Срок ключа истёк {formatKeyExpiry(expires)}.</p>
                <Link className="btn btn-amber" to="/buy#renew">Продлить снова</Link>
              </>
            ) : (
              <>
                <p className="soft">Ключ активен до {formatKeyExpiry(expires)}. Спасибо за доверие!</p>
                {/* У истёкшего ключа рядом с «Продлить снова» строка двусмысленна — только здесь. */}
                <p className="soft">Ключ остаётся прежним, вводить его заново не нужно.</p>
              </>
            )}
          </>
        )
      }
      return (
        <>
          <h1>Срок Вашего ключа продлён на {days}</h1>
          <p className="soft">Ключ остаётся прежним, вводить его заново не нужно.</p>
        </>
      )
    }
    if (o.key_purged) {
      return (
        <>
          <h1>Ключ больше нельзя открыть</h1>
          <p className="soft">Ключ не открыли в течение 7 дней после {isFree(o) ? 'оформления' : 'оплаты'}, и он скрыт навсегда — напишите в поддержку.</p>
          <SupportContacts />
        </>
      )
    }
    const windowOpen = !o.reveal_until || Date.now() < Date.parse(o.reveal_until)
    if (reveal === 'issued' || (o.key_revealed && (!o.key_ready || !windowOpen))) {
      return (
        <>
          <h1>Ключ уже выдан</h1>
          <p className="soft">Время повторного показа закончилось. Если ключ потерялся — напишите нам.</p>
          <SupportContacts />
        </>
      )
    }
    if (o.key_ready && windowOpen) {
      return (
        <>
          <h1>Ключ готов</h1>
          <p className="soft">Нажмите кнопку — ключ появится здесь. Сохраните его сразу.</p>
          <button type="button" className="btn btn-amber btn-lg" onClick={showKey} disabled={reveal === 'loading'}>
            {o.key_revealed ? 'Показать ключ ещё раз' : 'Показать ключ'}
          </button>
          {reveal === 'not_ready' && (
            <p className="billing-msg billing-msg-warn" role="alert">Ключ ещё готовится. Попробуйте через минуту.</p>
          )}
          {reveal === 'rate_limited' && (
            <p className="billing-msg billing-msg-warn" role="alert">
              Слишком много попыток. Попробуйте {retryAfter ? `через ${waitLabel(retryAfter)}` : 'чуть позже'}.
            </p>
          )}
          {reveal === 'error' && (
            <p className="billing-msg billing-msg-bad" role="alert">Не удалось получить ключ. Попробуйте ещё раз.</p>
          )}
        </>
      )
    }
    if (o.kind === 'new') {
      return (
        <>
          <h1>Ключ сейчас недоступен</h1>
          <p className="soft">{isFree(o) ? 'Заказ оформлен' : 'Оплата прошла'}, но показать ключ не получается. Напишите нам — разберёмся.</p>
          <SupportContacts />
        </>
      )
    }
    // Старый шлюз без kind: выдан, но нового ключа нет — скорее всего продление.
    return (
      <>
        <h1>{isFree(o) ? 'Заказ оформлен' : 'Оплата прошла'}</h1>
        <p className="soft">
          Если Вы продлевали ключ — срок прежнего ключа продлён на {o.duration_days}{' '}
          {plural(o.duration_days, 'день', 'дня', 'дней')}, ключ остаётся тем же. Если ждали новый ключ, напишите нам.
        </p>
        <SupportContacts />
      </>
    )
  }

  // Кнопка — только по полю шлюза (он сам решает: новый ключ, окно показа
  // открыто, ссылка не использована). Ссылку не логируем и никуда не пишем:
  // она даёт право привязать Telegram к ключу.
  function renderTgLink(o: Order) {
    if (!isTgLink(o.tg_link_url)) return null
    return (
      <div className="billing-tg">
        <a className="btn btn-ghost" href={o.tg_link_url} target="_blank" rel="noopener noreferrer">Привязать Telegram</a>
        <p className="soft billing-note">
          бот напомнит ключ, если Вы его потеряете, и даст скидку 5{' '}% на продление за подписку на канал @flibclub
        </p>
      </div>
    )
  }

  // Форма — только по contact_status = deferred от шлюза. none («почту не
  // давали» или хранилище выключено) снова не просим (решение владельца).
  function renderContact(o: Order) {
    if (contactState === 'saved') return <p className="billing-msg billing-msg-ok" role="status">Почта сохранена.</p>
    if (contactState === 'hidden' || o.contact_status !== 'deferred' || CONTACT_CLOSED.has(o.status)) return null
    // После перевыпуска ключа копию по этому заказу шлюз не пришлёт.
    if (o.key_replaced === true) return null
    // Заказ по ссылке продления: почту по нему шлюз не принимает (contact_not_allowed).
    if (o.via_link === true) return null
    const sending = contactState === 'sending'
    return (
      <EmailFields
        heading="Оставьте почту"
        email={contactEmail}
        confirm={contactConfirm}
        onEmail={v => onContactChange(setContactEmail, v)}
        onConfirm={v => onContactChange(setContactConfirm, v)}
        disabled={sending}
        error={contactError}
        intro={<p className="faint billing-note">При оформлении заказа почта не сохранилась. Пришлём копию ключа на этот адрес почты:</p>}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={saveContact}
          disabled={sending || !emailsReady(contactEmail, contactConfirm)}
        >
          {sending ? 'Сохраняем…' : 'Сохранить почту'}
        </button>
      </EmailFields>
    )
  }

  function renderReceipt(o: Order) {
    if (isFree(o)) return null
    const receipt = safeHttps(o.receipt_url)
    if (receipt) {
      return (
        <p className="billing-receipt">
          <a href={receipt} target="_blank" rel="noopener noreferrer">Чек</a>
        </p>
      )
    }
    if (o.status === 'paid' || o.status === 'fulfilled') {
      return <p className="faint billing-receipt">Чек появится здесь в течение 2 часов после оплаты.</p>
    }
    return null
  }
}
