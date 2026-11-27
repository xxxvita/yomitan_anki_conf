// EmailFields.tsx — два поля почты покупателя: «Почта» и «Повторите почту».
// Общие для /buy (заказ) и /order (почта после оплаты, contact_status deferred).
//
// Решения владельца 2026-11-16: во второе поле нельзя вставить и перетащить
// текст — адрес набирают руками второй раз; в первое вставить можно. Кнопка
// отправки у вызывающего недоступна, пока адреса не совпадут (emailsReady:
// trim и без учёта регистра).
//
// Почта — персональные данные: живёт только в состоянии вызывающего
// компонента. Ни в URL, ни в хранилища браузера, ни в события, ни в консоль.
// Второе поле не запоминается браузером (autocomplete=off), иначе автозаполнение
// обходило бы повторный ввод.
import { useId, useState, type ReactNode } from 'react'
import { EMAIL_MAX_LEN, normalizeEmail } from './billing-api'

interface EmailFieldsProps {
  heading: string
  email: string
  confirm: string
  onEmail: (v: string) => void
  onConfirm: (v: string) => void
  disabled: boolean
  /** Ошибка у полей (отказ шлюза по формату и т. п.). Адрес в тексте не повторяется. */
  error: string | null
  /** Пояснение сразу под заголовком, НАД полями (текст с двоеточием указывает на поля). */
  intro?: ReactNode
  /** Всё, что идёт после полей и сообщений: подсказки, ссылки, кнопка. */
  children?: ReactNode
}

const block = (e: { preventDefault: () => void }) => e.preventDefault()

/** Отказы шлюза по почте (400 email_invalid / email_required) — у полей почты. */
export const EMAIL_INVALID_TEXT = 'Проверьте адрес почты: похоже, в нём ошибка.'
export const EMAIL_REQUIRED_TEXT = 'Укажите почту.'

export function EmailFields({ heading, email, confirm, onEmail, onConfirm, disabled, error, intro, children }: EmailFieldsProps) {
  const emailId = useId()
  const confirmId = useId()
  // «Не совпадают» — только когда второй адрес набран: поле покинуто или
  // догнало первое по длине. С первого символа подсказка мигала бы на
  // каждой букве.
  const [confirmLeft, setConfirmLeft] = useState(false)
  const a = email.trim()
  const b = confirm.trim()
  const typed = confirmLeft || b.length >= a.length
  const mismatch = a !== '' && b !== '' && typed && normalizeEmail(a) !== normalizeEmail(b)
  return (
    <section className="billing-email">
      <h2>{heading}</h2>
      {intro}
      <div className="billing-field">
        <label htmlFor={emailId}>Почта</label>
        <input
          id={emailId}
          className="login-key-input"
          type="email"
          inputMode="email"
          value={email}
          onChange={e => onEmail(e.target.value)}
          maxLength={EMAIL_MAX_LEN}
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
        />
      </div>
      <div className="billing-field">
        <label htmlFor={confirmId}>Повторите почту</label>
        <input
          id={confirmId}
          className="login-key-input"
          type="email"
          inputMode="email"
          value={confirm}
          onChange={e => onConfirm(e.target.value)}
          onBlur={() => setConfirmLeft(true)}
          onPaste={block}
          onDrop={block}
          maxLength={EMAIL_MAX_LEN}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
        />
      </div>
      {mismatch && <p className="billing-msg billing-msg-warn" role="status">Адреса не совпадают.</p>}
      {error && <p className="billing-msg billing-msg-bad" role="alert">{error}</p>}
      {children}
    </section>
  )
}
