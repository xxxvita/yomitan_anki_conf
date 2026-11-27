// LoginForm.tsx — новое окно входа кабинета (спека 2026-11-17 §3.3, §3.7, §3.9;
// дизайн владельца docs/design/cabinet-2026-11-17, экран «Вход»).
//
// Одна кнопка «Войти»: POST /api/session (site/session.ts loginWithKey). Ключ
// живёт только в поле ввода и в одном запросе; после успеха поле очищается,
// старые ключи браузера стирает loginWithKey (clearLegacyKeys), переход — в
// кабинет. Защита от перебора — только на сервере: отсчёт берётся из
// retry_after_sec ответа, своего счётчика попыток у окна нет.
//
// Тексты: для состояний, что есть и в дизайне, и в спеке, — текст дизайна
// (неверный ключ, ключ истёк; решение владельца 2026-11-18); остальные — §3.9.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CabBrand, CabI } from './cabinet/cab-icons'
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL, TELEGRAM_BOT_URL } from './external-links'
import { plural } from './plural'
import { loginWithKey, refreshSession, type LoginResult } from './session'
import './cabinet/cabinet.css'

const KEY_RE = /^tpk_[0-9a-f]{32}$/

type FormState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'format' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'unavailable' }
  | { kind: 'locked'; wait: number }

export type LoginNotice = 'logout' | 'revoked' | null

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function LoginForm({ notice, onSuccess }: { notice: LoginNotice; onSuccess: () => void }) {
  const [val, setVal] = useState('')
  const [show, setShow] = useState(false)
  const [st, setSt] = useState<FormState>({ kind: 'idle' })
  const [noticeShown, setNoticeShown] = useState<LoginNotice>(notice)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Живой отсчёт паузы: по секунде, на нуле — снова ввод.
  useEffect(() => {
    if (st.kind !== 'locked') return
    const t = setTimeout(() => {
      setSt(st.wait <= 1 ? { kind: 'idle' } : { kind: 'locked', wait: st.wait - 1 })
    }, 1000)
    return () => clearTimeout(t)
  }, [st])

  const locked = st.kind === 'locked'
  const loading = st.kind === 'loading'

  async function submit(e: FormEvent) {
    e.preventDefault()
    const key = val.trim()
    if (!key || loading || locked) return
    setNoticeShown(null)
    if (!KEY_RE.test(key)) { setSt({ kind: 'format' }); return }
    setSt({ kind: 'loading' })
    let res: LoginResult = await loginWithKey(key)
    // Пауза ≤ 1 с (интервал адреса после двойного нажатия, ревью m-12) или
    // занятый семафор проверок — молча ждём и повторяем один раз.
    if ((res.kind === 'too_many' && res.retryAfterSec <= 1) || res.kind === 'busy') {
      await sleep(res.retryAfterSec * 1000)
      if (!alive.current) return
      res = await loginWithKey(key)
    }
    if (!alive.current) return
    switch (res.kind) {
      case 'ok':
        setVal('')
        onSuccess()
        return
      case 'bad_format': setSt({ kind: 'format' }); return
      case 'invalid': setSt({ kind: 'invalid' }); return
      case 'expired': setSt({ kind: 'expired' }); return
      case 'revoked': setSt({ kind: 'revoked' }); return
      case 'too_many': setSt({ kind: 'locked', wait: res.retryAfterSec }); return
      case 'off':
        // Кабинет выключили между проверкой и входом: перечитать режим —
        // страница сама вернёт прежнее окно.
        void refreshSession()
        setSt({ kind: 'unavailable' })
        return
      default: setSt({ kind: 'unavailable' })
    }
  }

  function onChange(v: string) {
    setVal(v)
    if (st.kind !== 'locked' && st.kind !== 'loading' && st.kind !== 'idle') setSt({ kind: 'idle' })
    setNoticeShown(null)
  }

  return (
    <div className="cab cab-login">
      <div className="login">
        <div className="login-top">
          <CabBrand />
          {/* «/» — лендинг шлюза, полный переход, не SPA. */}
          <a href="/" className="link">На главную</a>
        </div>
        <div className="login-mid">
          <form className="login-card" onSubmit={submit} noValidate>
            <h1>Вход</h1>
            {noticeShown === 'logout' && (
              <div className="msg warn" role="status"><CabI.alert /><span>Вы вышли из кабинета</span></div>
            )}
            {noticeShown === 'revoked' && <RevokedMsg />}
            <label className="field">
              <span className="mono">Ключ доступа</span>
              <div className={'inp' + (st.kind === 'invalid' || st.kind === 'format' ? ' bad' : '')}>
                <input
                  type={show ? 'text' : 'password'}
                  placeholder="tpk_…"
                  value={val}
                  disabled={locked}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  aria-invalid={st.kind === 'invalid' || st.kind === 'format'}
                  onChange={e => onChange(e.target.value)}
                />
                <button type="button" className="eye" aria-label={show ? 'Скрыть ключ' : 'Показать ключ'} onClick={() => setShow(!show)}>
                  {show ? <CabI.eyeOff /> : <CabI.eye />}
                </button>
              </div>
            </label>
            {st.kind === 'format' && (
              <div className="msg err" role="alert"><CabI.alert /><span>Ключ начинается с tpk_ и состоит из 36 символов</span></div>
            )}
            {st.kind === 'invalid' && (
              <div className="msg err" role="alert"><CabI.alert /><span>Ключ не найден. Проверьте, что он скопирован целиком, вместе с «tpk_».</span></div>
            )}
            {st.kind === 'expired' && (
              <div className="msg warn" role="alert"><CabI.clock /><span>Срок ключа закончился. <a href="/buy">Продлить</a> — маршрут сохранится.</span></div>
            )}
            {st.kind === 'revoked' && <RevokedMsg />}
            {st.kind === 'unavailable' && (
              <div className="msg err" role="alert"><CabI.alert /><span>Сервер сейчас не отвечает. Попробуйте ещё раз через несколько секунд</span></div>
            )}
            {st.kind === 'locked' && (
              <div className="msg err" role="alert"><CabI.lock /><span>Слишком много попыток. Попробуйте через {st.wait} {plural(st.wait, 'секунду', 'секунды', 'секунд')}</span></div>
            )}
            <button type="submit" className="btn primary" disabled={!val.trim() || locked || loading}>
              {loading ? <><span className="spin" aria-hidden="true" />Проверяем</> : 'Войти'}
            </button>
            <div className="nokey">
              <span className="mute">Нет ключа?</span>
              <a href="/buy">Купить ключ</a>
              <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">Демо-ключ в Telegram-боте</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function RevokedMsg() {
  return (
    <div className="msg err" role="alert">
      <CabI.alert />
      <span>
        Этот ключ больше не действует. Если Вам выдали новый ключ — войдите им. Вопросы —{' '}
        <a href={SUPPORT_BOT_URL} target="_blank" rel="noopener noreferrer">@{SUPPORT_BOT_HANDLE}</a>
      </span>
    </div>
  )
}
