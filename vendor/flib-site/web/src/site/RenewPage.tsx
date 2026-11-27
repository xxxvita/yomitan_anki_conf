// RenewPage.tsx — /renew, клик по ссылке продления из письма.
//
// Адрес письма: /renew#t=<токен>. Токен живёт только во фрагменте: на сервер
// фрагмент не уходит, а страница снимает его из адреса (replaceState) в самом
// начале, ДО любого запроса — в историю, в Referer и в закладки он не попадает.
// Дальше токен лежит только в состоянии компонента и уходит единственный раз —
// в теле POST /api/billing/renew-link/redeem. Страница не грузит сторонних
// ресурсов; Referrer-Policy: no-referrer отдаёт BFF (isBillingPage в main.go).
//
// GET страницы ничего не создаёт: заказ рождает только POST этого скрипта, так
// что предпросмотр ссылки мессенджером или почтовым сканером заказа не откроет.
// view_token заказа BFF кладёт в HttpOnly-cookie сам, поэтому /order/<id> после
// возврата из ЮKassa работает.
//
// Бесплатный заказ (сумма 0 ₽) шлюз сначала просит подтвердить явно (409
// confirm_required): «Продлить бесплатно». Промокод, переставший действовать,
// — 409 promo_no_longer_valid: предлагаем оплатить без скидки (drop_promo).
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { formatRub, redeemRenewLink, type RedeemOpts, type RedeemResult } from './billing-api'
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL } from './external-links'

// Токен шлюза — base32, ~26 символов; набор шире на случай смены формата, но
// тот же, что допускает BFF (billingTokenRe).
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

type Failure = Exclude<RedeemResult, { kind: 'ok' }>

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'fail'; result: Failure }

interface RenewPageProps {
  /** Переход на оплату ЮKassa; подменяется в тестах. location.replace — страницу нельзя вернуть кнопкой «назад». */
  redirect?: (url: string) => void
}

function tokenFromHash(hash: string): string | null {
  const m = /^#t=([^&]*)$/.exec(hash)
  if (!m) return null
  return TOKEN_RE.test(m[1]) ? m[1] : null
}

export function RenewPage({ redirect = url => window.location.replace(url) }: RenewPageProps) {
  const navigate = useNavigate()
  // Токен читается один раз. Под StrictMode инициализатор вызывается дважды, но
  // фрагмент снимается только в эффекте, поэтому оба вызова видят одно значение.
  const [token] = useState(() => tokenFromHash(window.location.hash))
  const [view, setView] = useState<View>(token ? { kind: 'loading' } : { kind: 'invalid' })
  const inFlight = useRef(false)
  const started = useRef(false)
  const opts = useRef<RedeemOpts>({})
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    // Первым делом, до любого запроса: токена в адресе больше нет.
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
    if (token && !started.current) {
      started.current = true
      void run()
    }
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run(next?: RedeemOpts) {
    if (!token || inFlight.current) return
    if (next) opts.current = { ...opts.current, ...next }
    inFlight.current = true
    setView({ kind: 'loading' })
    const r = await redeemRenewLink(token, opts.current)
    inFlight.current = false
    if (!alive.current) return
    if (r.kind === 'ok') {
      // Кнопку не разблокируем: страница сейчас уйдёт.
      if (r.confirmationUrl) redirect(r.confirmationUrl)
      else navigate(`/order/${r.orderId}`, { replace: true })
      return
    }
    setView({ kind: 'fail', result: r })
  }

  function body() {
    if (view.kind === 'loading') return <p className="soft" role="status">Открываем оплату…</p>
    if (view.kind === 'invalid') return failBlock('Ссылка недействительна.')
    const r = view.result
    switch (r.kind) {
      case 'link_expired': return failBlock('Срок ссылки истёк. Запросите новую на странице покупки.')
      case 'link_replaced': return failBlock('Эта ссылка заменена более новой. Откройте последнее письмо или запросите ссылку заново.')
      case 'link_used':
        return (
          <>
            <p className="billing-msg billing-msg-bad" role="alert">По этой ссылке уже оплачено продление.</p>
            <p><Link to="/buy">На страницу покупки</Link></p>
          </>
        )
      case 'not_found': return failBlock('Ссылка недействительна.')
      case 'key_not_renewable':
        return (
          <>
            <p className="billing-msg billing-msg-bad" role="alert">
              Этот ключ сейчас нельзя продлить. Напишите в поддержку:{' '}
              <a href={SUPPORT_BOT_URL} target="_blank" rel="noopener noreferrer">@{SUPPORT_BOT_HANDLE}</a>.
            </p>
            <p><Link to="/buy">На страницу покупки</Link></p>
          </>
        )
      case 'confirm_required':
        return (
          <>
            <p className="billing-msg" role="status">Продление бесплатно по промокоду.</p>
            <button type="button" className="btn btn-amber" onClick={() => void run({ confirmFree: true })}>Продлить бесплатно</button>
          </>
        )
      case 'promo_gone':
        return (
          <>
            <p className="billing-msg billing-msg-bad" role="alert">Промокод больше не действует.</p>
            <button type="button" className="btn btn-amber" onClick={() => void run({ dropPromo: true })}>
              {r.priceKopecks != null ? `Оплатить ${formatRub(r.priceKopecks)} без скидки` : 'Оплатить без скидки'}
            </button>
            <p><Link to="/buy#renew">На страницу покупки</Link></p>
          </>
        )
      default:
        return (
          <>
            <p className="billing-msg billing-msg-bad" role="alert">Не удалось открыть оплату. Попробуйте ещё раз.</p>
            <button type="button" className="btn btn-amber" onClick={() => void run()}>Повторить</button>
          </>
        )
    }
  }

  function failBlock(text: string) {
    return (
      <>
        <p className="billing-msg billing-msg-bad" role="alert">{text}</p>
        <Link className="btn btn-amber" to="/buy#renew">На страницу покупки</Link>
      </>
    )
  }

  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow billing-page">
          <div className="page-topbar">
            <BrandMark label="FLIBOOSTER" />
          </div>
          <h1>Продление ключа</h1>
          {body()}
        </div>
      </div>
    </div>
  )
}
