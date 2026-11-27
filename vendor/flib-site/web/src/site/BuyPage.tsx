// BuyPage.tsx — /buy, покупка или продление доступа.
//
// Тарифы, названия и цены приходят с сервера (/api/billing/products), в коде
// их нет. «Оплатить» создаёт заказ через BFF: есть confirmation_url — уходим
// на страницу оплаты ЮKassa, нет (бесплатный промокод) — сразу на /order/<id>.
// Токен заказа BFF кладёт в HttpOnly-cookie, страница его не видит.
//
// «Применить» у промокода спрашивает BFF, к каким тарифам код применим
// (/api/billing/promo/check, ничего не бронирует). В этих карточках старая
// цена зачёркнута; заказ на остальные уходит БЕЗ кода. Любая правка поля
// сбрасывает проверку. Если проверки нет (шлюз без ручки) или код не
// проверяли, код уходит в заказ как раньше — его проверит заказ.
//
// Режим — переключатель «Новый ключ / Продлить мой ключ». Ключ для продления
// уходит в заказ ТОЛЬКО в режиме продления (в режиме нового ключа введённый
// раньше ключ игнорируется). Ключ и промокод живут только в состоянии
// компонента: ни в URL, ни в localStorage/sessionStorage. Блок продления —
// #renew: на /buy#renew ведёт кнопка «Продлить» в приложении, поэтому по этому
// якорю страница открывается в режиме продления, прокручивает к блоку и ставит
// фокус в поле ключа.
//
// Кнопка оплаты одна — сразу под тарифами (см. payButton).
//
// /buy?product=<id> (карточки тарифов на лендинге) выбирает этот тариф, если
// он есть среди активных; иначе — первый, как без параметра.
//
// Почта покупателя (решения владельца 2026-11-16): под выбором тарифа — два
// поля (EmailFields), и для нового доступа, и для продления; «Оплатить»
// недоступна, пока адреса не совпадут. В заказ уходит первое поле без пробелов
// по краям, формат проверяет шлюз. Почта — персональные данные: только в теле
// заказа, ни в URL, ни в хранилища, ни в события и консоль.
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import {
  checkPromo, createOrder, emailsReady, fetchProducts, formatRub, perMonthKopecks, promoBytes, requestRenewLink, waitLabel,
  PROMO_MAX_BYTES, RENEW_BY_EMAIL,
  type CreateResult, type Product, type PromoCheckResult, type PromoPrice, type RenewLinkResult,
} from './billing-api'
import { EMAIL_INVALID_TEXT, EMAIL_REQUIRED_TEXT, EmailFields } from './EmailFields'
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL, TELEGRAM_CHANNEL_HANDLE, TELEGRAM_CHANNEL_URL } from './external-links'
import { plural } from './plural'

// Подсказка под полями почты. Продление — когда заполнено поле «Ключ,
// который нужно продлить» (`renewing` в BuyPage; то же условие, по которому
// renew_key уходит в заказ; якорь #renew только прокручивает к блоку).
// Нового ключа при продлении нет, и подсказка не должна его обещать: в режиме
// продления строки нет вовсе (решение владельца 2026-11-17). Менять — здесь.
const KEY_REQUIRED_TEXT = 'Укажите ключ.'
// Поле продления при RENEW_BY_EMAIL: «@» — почта, tpk_ — ключ, прочее — подсказка.
const KEY_OR_EMAIL_TEXT = 'Укажите ключ (tpk_…) или почту.'
// Та же страница без продления по почте: «@» в поле — ошибка.
const KEY_ONLY_TEXT = 'Укажите ключ (tpk_…).'
const LINK_LABEL = 'Прислать ссылку для оплаты'
// После «Отправлено» повторная отправка заменила бы только что присланную
// ссылку (шлюз: новая ссылка гасит старую) — кнопка заперта на минуту.
const LINK_LOCK_MS = 60_000

type Mode = 'new' | 'renew'

function emailHint(renewing: boolean): string | null {
  return renewing ? null : 'Проверьте адрес внимательно: ключ будет показан на экране и придёт на эту почту.'
}

function tg(url: string, handle: string) {
  return <a href={url} target="_blank" rel="noopener noreferrer">@{handle}</a>
}

function durationLabel(days: number): string {
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`
}

const PROMO_INVALID_TEXT = 'Промокод не подошёл. Проверьте его или оплатите без промокода.'

function errorMessage(r: Exclude<CreateResult, { kind: 'ok' }>): string {
  switch (r.kind) {
    case 'promo_invalid': return PROMO_INVALID_TEXT
    case 'key_not_renewable': return 'Этот ключ нельзя продлить. Проверьте ключ или оформите новый доступ на вкладке «Новый ключ».'
    case 'product_unavailable': return 'Этот тариф сейчас недоступен. Обновите страницу.'
    case 'payments_unavailable': return 'Оплата временно недоступна. Попробуйте через несколько минут.'
    case 'rate_limited':
      return r.retryAfterSec
        ? `Слишком много попыток. Попробуйте через ${waitLabel(r.retryAfterSec)}.`
        : 'Слишком много попыток. Попробуйте чуть позже.'
    case 'timeout': return 'Сервер долго не отвечает. Проверьте соединение и попробуйте ещё раз.'
    case 'network': return 'Нет связи с сервером. Проверьте интернет и попробуйте снова.'
    default: return 'Не удалось оформить заказ. Попробуйте ещё раз.'
  }
}

type LinkMsg = { text: string; tone: 'ok' | 'bad'; small?: string }

function linkFailMessage(r: Exclude<RenewLinkResult, { kind: 'sent' }>): string {
  switch (r.kind) {
    case 'no_key': return 'На эту почту не оформлен ни один ключ.'
    case 'no_renewable': return `Ключ на этой почте нельзя продлить выбранным тарифом. Напишите в поддержку: @${SUPPORT_BOT_HANDLE}.`
    case 'email_invalid': return 'Проверьте адрес почты.'
    case 'promo_invalid': return PROMO_INVALID_TEXT
    case 'product_unavailable': return 'Этот тариф сейчас недоступен. Обновите страницу.'
    case 'rate_limited':
      return r.retryAfterSec
        ? `Слишком много попыток. Попробуйте через ${Math.max(1, Math.ceil(r.retryAfterSec / 60))} мин.`
        : 'Слишком много попыток. Попробуйте позже.'
    default: return 'Не удалось отправить ссылку. Попробуйте ещё раз немного позже.'
  }
}

type PromoMsg = { text: string; tone: 'ok' | 'bad' | 'note' }

function promoFailMessage(r: Exclude<PromoCheckResult, { kind: 'ok' }>): PromoMsg {
  switch (r.kind) {
    case 'promo_invalid': return { text: PROMO_INVALID_TEXT, tone: 'bad' }
    case 'unavailable': return { text: 'Код проверим при оформлении заказа.', tone: 'note' }
    case 'rate_limited':
      return {
        text: r.retryAfterSec
          ? `Слишком много проверок. Попробуйте через ${waitLabel(r.retryAfterSec)}.`
          : 'Слишком много проверок. Попробуйте чуть позже.',
        tone: 'bad',
      }
    default: return { text: 'Не удалось проверить код. Его проверим при оформлении заказа.', tone: 'note' }
  }
}

/** Результат «Применить» для конкретного текста поля. */
interface PromoCheck {
  code: string
  /** Тарифы витрины, к которым код применим. Пусто — ни к одному. */
  offers: Map<string, PromoPrice>
}

interface BuyPageProps {
  /** Переход на страницу оплаты; подменяется в тестах (jsdom не умеет уходить со страницы). */
  redirect?: (url: string) => void
  /** Продление по почте; по умолчанию — сборочная константа RENEW_BY_EMAIL. */
  renewByEmail?: boolean
}

export function BuyPage({ redirect = url => window.location.assign(url), renewByEmail = RENEW_BY_EMAIL }: BuyPageProps) {
  const navigate = useNavigate()
  const { hash, search } = useLocation()
  // Тариф из ссылки (/buy?product=<id>, карточки лендинга): берётся один раз,
  // при загрузке витрины. Нет такого активного тарифа или параметра — первый.
  const wantedProduct = useRef(new URLSearchParams(search).get('product'))
  const promoInputId = useId()
  const hintId = useId()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [promo, setPromo] = useState('')
  const [promoCheck, setPromoCheck] = useState<PromoCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [promoMsg, setPromoMsg] = useState<PromoMsg | null>(null)
  const [mode, setMode] = useState<Mode>(hash === '#renew' ? 'renew' : 'new')
  const [renewKey, setRenewKey] = useState('')
  const [email, setEmail] = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Продление по почте: результат запроса ссылки и запор кнопки после отправки.
  const [linkMsg, setLinkMsg] = useState<LinkMsg | null>(null)
  const [linkLock, setLinkLock] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const linkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Режим продления — переключатель; ключ в заказ уходит только в нём.
  const renewing = mode === 'renew'
  const renewValue = renewKey.trim()
  // Почтовый путь: в поле «@». Вход в него — только при включённой сборке.
  const emailPath = renewing && renewByEmail && renewValue.includes('@')
  // Ключ: с RENEW_BY_EMAIL — только tpk_…; без него — как раньше любая непустая
  // строка, кроме «@» (почта там не принимается вовсе).
  const keyOk = renewByEmail ? renewValue.startsWith('tpk_') && !renewValue.includes('@') : renewValue !== '' && !renewValue.includes('@')
  const emailOk = emailPath || emailsReady(email, emailConfirm)
  const emailEmpty = !emailPath && email.trim() === ''
  // Синхронная защита от двойного клика: setSubmitting применится только на
  // следующем рендере, а второй click приходит раньше.
  const inFlight = useRef(false)
  const promoInFlight = useRef(false)
  // Номер текущего текста поля: ответ проверки, пришедший после правки поля,
  // относится к старому коду и не применяется.
  const promoSeq = useRef(0)
  const promoAbort = useRef<AbortController | null>(null)
  const renewRef = useRef<HTMLElement>(null)
  const renewInputRef = useRef<HTMLInputElement>(null)

  // Фокус в поле ключа после ручного переключения на «Продлить мой ключ».
  const focusAfterSwitch = useRef(false)

  useEffect(() => {
    if (hash === '#renew') setMode('renew')
    else window.scrollTo(0, 0)
  }, [hash])

  // Блок ключа есть только в режиме продления: прокрутка и фокус — когда он уже
  // нарисован.
  useEffect(() => {
    if (hash === '#renew' && mode === 'renew') {
      renewRef.current?.scrollIntoView?.({ block: 'center' })
      renewInputRef.current?.focus({ preventScroll: true })
    }
  }, [hash, mode])

  useEffect(() => {
    if (mode === 'renew' && focusAfterSwitch.current) {
      focusAfterSwitch.current = false
      renewInputRef.current?.focus({ preventScroll: true })
    }
  }, [mode])

  function selectMode(m: Mode) {
    if (m === mode) return
    if (m === 'renew') focusAfterSwitch.current = true
    setMode(m)
    setError(null)
    // Почта из поля продления не должна пережить переключение: ни в новый
    // заказ, ни на экран при возврате.
    if (renewByEmail) { resetLink(); setRenewKey('') }
  }

  // Первая прокрутка к #renew идёт до загрузки тарифов: на телефоне карточки
  // потом выталкивают поле ключа за экран. Поэтому один раз после загрузки —
  // ещё одна (плавная, если человек не просил меньше движения). Фокус
  // возвращаем в поле ключа, только если его не увели в другое поле.
  const renewRescrolled = useRef(false)
  useEffect(() => {
    if (hash !== '#renew' || mode !== 'renew' || !products || renewRescrolled.current) return
    renewRescrolled.current = true
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    renewRef.current?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    const active = document.activeElement
    if (!active || active === document.body || active === renewInputRef.current) {
      renewInputRef.current?.focus({ preventScroll: true })
    }
  }, [hash, mode, products])

  useEffect(() => {
    const ctl = new AbortController()
    fetchProducts(ctl.signal).then(r => {
      if (ctl.signal.aborted) return
      if (r.kind === 'ok' && r.products.length > 0) {
        setProducts(r.products)
        const wanted = r.products.find(p => p.id === wantedProduct.current)
        setSelected(cur => cur ?? (wanted ?? r.products[0]).id)
      } else {
        setLoadFailed(true)
      }
    })
    return () => ctl.abort()
  }, [])

  // Уход со страницы отменяет идущую проверку и запор кнопки ссылки.
  useEffect(() => () => {
    promoAbort.current?.abort()
    if (linkTimer.current) clearTimeout(linkTimer.current)
  }, [])

  // Сброс почтового пути: результат, запор и метка «отправлено».
  function resetLink() {
    if (linkTimer.current) { clearTimeout(linkTimer.current); linkTimer.current = null }
    setLinkMsg(null)
    setLinkLock(false)
    setLinkSent(false)
  }

  function onRenewChange(value: string) {
    setRenewKey(value)
    // Другой текст — другая почта (или ключ): прежний результат к нему не относится.
    if (value.trim() !== renewKey.trim()) resetLink()
  }

  function onPromoChange(value: string) {
    const changed = value.trim() !== promo.trim()
    setPromo(value)
    // Пробелы вокруг того же кода — тот же код: проверка остаётся в силе.
    if (!changed) return
    promoSeq.current++
    promoAbort.current?.abort()
    promoAbort.current = null
    promoInFlight.current = false
    setChecking(false)
    setPromoCheck(null)
    setPromoMsg(null)
  }

  async function applyPromo() {
    const code = promo.trim()
    if (!code || !products || promoInFlight.current || inFlight.current) return
    if (promoCheck?.code === code) return // уже проверен
    if (promoBytes(code) > PROMO_MAX_BYTES) {
      // Такой код BFF не примет ни в проверке, ни в заказе.
      setPromoCheck(null)
      setPromoMsg({ text: PROMO_INVALID_TEXT, tone: 'bad' })
      return
    }
    promoInFlight.current = true
    setChecking(true)
    setPromoMsg(null)
    const seq = ++promoSeq.current
    const ctl = new AbortController()
    promoAbort.current = ctl
    let r: PromoCheckResult
    try {
      r = await checkPromo(code, ctl.signal)
    } finally {
      // Правка поля уже сняла блокировку и, возможно, запустила новую проверку.
      if (seq === promoSeq.current) {
        promoInFlight.current = false
        promoAbort.current = null
        setChecking(false)
      }
    }
    if (seq !== promoSeq.current) return
    if (r.kind !== 'ok') {
      setPromoCheck(null)
      setPromoMsg(promoFailMessage(r))
      return
    }
    const shown = new Set(products.map(p => p.id))
    const offers = new Map(r.products.filter(o => shown.has(o.product_id)).map(o => [o.product_id, o]))
    setPromoCheck({ code, offers })
    if (offers.size === 0) setPromoMsg({ text: 'Код не подходит к этим тарифам', tone: 'bad' })
    else if (offers.size === shown.size) setPromoMsg({ text: 'Промокод применён.', tone: 'ok' })
    else setPromoMsg({ text: 'Промокод действует только на тарифы с новой ценой. Остальные оформим без него.', tone: 'ok' })
  }

  function onEmailChange(set: (v: string) => void, value: string) {
    set(value)
    setEmailError(null)
  }

  // Почтовый путь: просим шлюз прислать ссылку. Заказ здесь не создаётся и
  // renew_key не уходит; оплата начнётся по ссылке из письма (/renew).
  async function sendLink() {
    if (inFlight.current || promoInFlight.current || !selected || linkLock) return
    const code = promo.trim()
    if (promoBytes(code) > PROMO_MAX_BYTES) {
      setLinkMsg({ text: PROMO_INVALID_TEXT, tone: 'bad' })
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setLinkMsg(null)
    const promoCode = promoCheck && promoCheck.code === code && !promoCheck.offers.has(selected) ? '' : code
    const to = renewValue
    const r = await requestRenewLink({ email: to, productId: selected, promoCode })
    inFlight.current = false
    setSubmitting(false)
    if (r.kind === 'sent') {
      setLinkMsg({
        text: `Мы отправили ссылку для оплаты на ${to}. Ссылка действует 3 дня.`,
        tone: 'ok',
        small: 'Если письма нет, проверьте папку «Спам».',
      })
      setLinkSent(true)
      setLinkLock(true)
      if (linkTimer.current) clearTimeout(linkTimer.current)
      linkTimer.current = setTimeout(() => { linkTimer.current = null; setLinkLock(false) }, LINK_LOCK_MS)
      return
    }
    if (r.kind === 'promo_invalid') {
      setPromoCheck(null)
      setPromoMsg(null)
    }
    setLinkMsg({ text: linkFailMessage(r), tone: 'bad' })
  }

  async function pay() {
    if (emailPath) { await sendLink(); return }
    if (inFlight.current || promoInFlight.current || !selected || !emailOk || (renewing && !keyOk)) return
    const code = promo.trim()
    if (promoBytes(code) > PROMO_MAX_BYTES) {
      setError(PROMO_INVALID_TEXT)
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    setEmailError(null)
    // Проверенный код уходит только в заказ на применимый тариф;
    // непроверенный — как раньше, его проверит заказ.
    const promoCode = promoCheck && promoCheck.code === code && !promoCheck.offers.has(selected) ? '' : code
    const r = await createOrder({ productId: selected, promoCode, renewKey: renewing ? renewKey.trim() : '', email: email.trim() })
    if (r.kind === 'ok') {
      // Кнопку не разблокируем: страница сейчас уйдёт, повторный заказ не нужен.
      if (r.confirmationUrl) redirect(r.confirmationUrl)
      else navigate(`/order/${r.orderId}`)
      return
    }
    inFlight.current = false
    setSubmitting(false)
    // Отказ по почте показываем у полей почты, а не под кнопкой.
    if (r.kind === 'email_invalid' || r.kind === 'email_required') {
      setEmailError(r.kind === 'email_invalid' ? EMAIL_INVALID_TEXT : EMAIL_REQUIRED_TEXT)
      return
    }
    if (r.kind === 'promo_invalid') {
      // Заказ решает окончательно: скидку из проверки больше не показываем.
      setPromoCheck(null)
      setPromoMsg(null)
    }
    setError(errorMessage(r))
  }

  // Выбранный тариф по проверенному промокоду стоит 0 ₽ — заказ бесплатный.
  const selectedOffer = selected ? promoCheck?.offers.get(selected) : undefined
  const freeSelected = selectedOffer?.amount_kopecks === 0
  const selectedProduct = products?.find(p => p.id === selected)
  const effectiveKopecks = selectedProduct
    ? (selectedOffer && selectedOffer.amount_kopecks !== selectedOffer.price_kopecks ? selectedOffer.amount_kopecks : selectedProduct.price_kopecks)
    : null

  // Подпись кнопки: сумма выбранного тарифа (со скидкой по проверенному коду).
  let payLabel = 'Оплатить'
  if (emailPath) payLabel = submitting ? 'Отправляем…' : linkLock ? 'Отправлено' : linkSent ? 'Прислать ещё раз' : LINK_LABEL
  else if (submitting) payLabel = 'Оформляем…'
  else if (freeSelected) payLabel = renewing ? 'Продлить ключ' : 'Получить ключ'
  else if (selectedProduct && effectiveKopecks != null) {
    payLabel = renewing
      ? `Продлить на ${durationLabel(selectedProduct.duration_days)} — ${formatRub(effectiveKopecks)}`
      : `Оплатить ${formatRub(effectiveKopecks)}`
  }

  // Почему кнопка недоступна. Несовпадение адресов объясняет сам блок почты.
  let renewHint: string | null = null
  if (renewing && !emailPath && !keyOk) {
    if (renewByEmail) renewHint = KEY_OR_EMAIL_TEXT
    else renewHint = renewValue.includes('@') ? KEY_ONLY_TEXT : KEY_REQUIRED_TEXT
  }
  const hint = renewHint ?? (emailEmpty ? EMAIL_REQUIRED_TEXT : null)
  const canPay = !submitting && !checking && !!selected && emailOk && (emailPath ? !linkLock : (!renewing || keyOk))

  function payButton() {
    return (
      <button
        type="button"
        className={`btn btn-amber buy2-pay${canPay ? '' : ' off'}`}
        onClick={() => void pay()}
        disabled={!canPay}
        aria-describedby={hint ? hintId : undefined}
      >
        {payLabel}
      </button>
    )
  }

  const orderError = () => {
    if (linkMsg && emailPath) {
      return (
        <>
          <p
            className={`billing-msg buy2-msg${linkMsg.tone === 'bad' ? ' billing-msg-bad' : ' billing-msg-ok'}`}
            role={linkMsg.tone === 'bad' ? 'alert' : 'status'}
          >
            {linkMsg.text}
          </p>
          {linkMsg.small && <p className="faint billing-note">{linkMsg.small}</p>}
        </>
      )
    }
    return error
      ? <p className="billing-msg billing-msg-bad buy2-msg" role="alert">{error}</p>
      : null
  }

  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow billing-page buy2">
          <div className="page-topbar">
            <BrandMark label="FLIBOOSTER" />
            <Link className="back-link" to="/">← на главную</Link>
          </div>

          <div className="buy2-head">
            <div className="eyebrow">доступ к рекомендациям</div>
            <h1>Доступ к рекомендациям</h1>
          </div>

          <div className="buy2-seg" role="tablist" aria-label="Что оформить">
            <button type="button" role="tab" aria-selected={!renewing} className={renewing ? '' : 'on'} onClick={() => selectMode('new')} disabled={submitting}>
              Новый ключ
            </button>
            <button type="button" role="tab" aria-selected={renewing} className={renewing ? 'on' : ''} onClick={() => selectMode('renew')} disabled={submitting}>
              Продлить мой ключ
            </button>
          </div>

          {renewing && (
            <section id="renew" ref={renewRef} className="buy2-keybox">
              <label className="billing-field">
                <span>{renewByEmail ? 'Ключ или почта, на которую он оформлен' : 'Ключ, который нужно продлить'}</span>
                <input
                  ref={renewInputRef}
                  className="login-key-input"
                  type="text"
                  value={renewKey}
                  onChange={e => onRenewChange(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder={renewByEmail ? 'tpk_… или name@mail.ru' : 'tpk_…'}
                  disabled={submitting}
                />
              </label>
              <p className="buy2-keynote">
                {emailPath
                  ? 'Пришлём на эту почту ссылку для оплаты. Срок добавится к текущему, ключ и маршрут останутся прежними.'
                  : 'Срок добавится к текущему. Ключ и маршрут останутся прежними.'}
              </p>
            </section>
          )}

          {!renewing && <p className="buy2-sub">Выберите срок доступа.</p>}

          {loadFailed && (
            <p className="billing-msg billing-msg-bad" role="alert">Не удалось загрузить тарифы. Обновите страницу.</p>
          )}
          {!products && !loadFailed && <p className="soft">Загружаем тарифы…</p>}

          {products && (
            <div className="buy2-plans" role="radiogroup" aria-label="Тариф">
              {products.map(p => {
                const offer = promoCheck?.offers.get(p.id)
                const discounted = !!offer && offer.amount_kopecks !== offer.price_kopecks
                const effective = discounted ? offer.amount_kopecks : p.price_kopecks
                const perMonth = perMonthKopecks(effective, p.duration_days)
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected === p.id}
                    className={`buy2-plan${selected === p.id ? ' on' : ''}`}
                    onClick={() => setSelected(p.id)}
                    disabled={submitting}
                  >
                    <h3>{renewing ? `+ ${p.title.replace(/\s+рекомендаци\S*$/i, '')}` : p.title}</h3>
                    {discounted ? (
                      <span className="buy2-price">
                        <s className="billing-price-old">{formatRub(offer.price_kopecks)}</s>
                        {' '}
                        <span className="billing-price-new">{formatRub(offer.amount_kopecks)}</span>
                      </span>
                    ) : (
                      <span className="buy2-price">{formatRub(p.price_kopecks)}</span>
                    )}
                    {perMonth != null && perMonth > 0 && (
                      <span className="buy2-per">{formatRub(perMonth)}/мес</span>
                    )}
                    <span className="buy2-days">{renewing ? `+${durationLabel(p.duration_days)} к ключу` : durationLabel(p.duration_days)}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="buy2-payblock">
            <div className="buy2-payrow">
              {payButton()}
              <div className={`buy2-promo${promo.trim() ? ' has' : ''}`}>
                <input
                  id={promoInputId}
                  className="login-key-input"
                  type="text"
                  value={promo}
                  onChange={e => onPromoChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void applyPromo() } }}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={submitting}
                  placeholder="Промокод"
                  aria-label="Промокод (если есть)"
                />
                <button
                  type="button"
                  className="buy2-apply"
                  onClick={applyPromo}
                  disabled={submitting || checking || !products || !promo.trim()}
                >
                  {checking ? 'Проверяем…' : 'Применить'}
                </button>
              </div>
            </div>
            {promoMsg && (
              <p
                className={`billing-msg buy2-msg${promoMsg.tone === 'bad' ? ' billing-msg-bad' : promoMsg.tone === 'ok' ? ' billing-msg-ok' : ''}`}
                role={promoMsg.tone === 'bad' ? 'alert' : 'status'}
              >
                {promoMsg.text}
              </p>
            )}
            {orderError()}
            {/* Почему кнопка недоступна: не введён ключ (продление) или почта
                (несовпадение объясняет сам блок почты). */}
            {hint && <p id={hintId} className="buy2-hint">{hint}</p>}
            <p className="faint billing-note buy2-foot">
              {/* Бесплатное продление — без слов об оплате и без обещания нового
                  ключа (решение владельца 2026-11-17). */}
              {emailPath
                ? 'Оплата через ЮKassa по ссылке из письма. Срок ключа продлим сразу после оплаты.'
                : freeSelected
                ? (renewing ? 'Срок ключа продлим сразу.' : 'Ключ покажем на следующей странице.')
                : renewing
                  ? 'Оплата через ЮKassa. Срок ключа продлим сразу после оплаты.'
                  : 'Оплата через ЮKassa. Ключ покажем на следующей странице после оплаты.'}
            </p>
          </div>

          {/* Почтовый путь: почта уже в поле ключа, вторая форма не нужна. */}
          {!emailPath && (
            <EmailFields
              heading={renewing ? 'Мы отправим подтверждение продления на эту почту:' : 'Мы отправим копию ключа на эту почту:'}
              email={email}
              confirm={emailConfirm}
              onEmail={v => onEmailChange(setEmail, v)}
              onConfirm={v => onEmailChange(setEmailConfirm, v)}
              disabled={submitting}
              error={emailError}
            >
              {emailHint(renewing) && <p className="faint billing-note">{emailHint(renewing)}</p>}
            </EmailFields>
          )}

          <p className="soft billing-note buy2-channel">
            Вступайте в канал {tg(TELEGRAM_CHANNEL_URL, TELEGRAM_CHANNEL_HANDLE)}. По техническим вопросам и проблемам с
            оплатой пишите в поддержку: {tg(SUPPORT_BOT_URL, SUPPORT_BOT_HANDLE)}.
          </p>
        </div>
      </div>
    </div>
  )
}
