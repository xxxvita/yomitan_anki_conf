// CabinetProfile.tsx — «Профиль»: почта (показать, изменить с подтверждением
// письмом на НОВЫЙ адрес), «Как к Вам обращаться», ключ (префикс, срок,
// «Продлить»), «Удалить мои данные» (запрос в поддержку с подтверждением на
// странице) и «Выход» (на телефоне он только здесь, DELTA п.3).
//
// Ось профиля на шлюзе может быть выключена (BFF → {available:false} или 404
// заглушки): тогда страница остаётся прежней — только «Ключ» и «Выход», без
// ошибок. Первичный сбой чтения — строки «временно недоступно», «Ключ» на месте;
// сбой ПЕРЕчитывания уже загруженный профиль не стирает (последние данные +
// пометка). Заметки о результатах и открытые формы живут на уровне страницы —
// перечитывание их не размонтирует. Данные привязаны к ключу сессии: смена
// ключа сбрасывает всё и перечитывает; запись под сменившимся ключом не уходит.
// Почта и имя — персональные данные: только в состоянии компонента.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCabinet } from './CabinetLayout'
import { CabI } from './cab-icons'
import { RENEW_HREF, untilShort } from './key-dates'
import {
  MAIL_AMBIGUOUS_TEXT, NAME_MAX_RUNES, PROFILE_CONSENT_TEXT, PROFILE_CONSENT_VERSION, isMailAmbiguous, profileApi, profileErrorText,
  profileIdent, runeLen, setProfileNameCache, type ProfileData,
} from './profile-api'
import { SUPPORT_BOT_HANDLE } from '../external-links'
import { invalidatePlacement } from './placement/use-placement'
import './profile.css'

type Load = { k: 'loading' } | { k: 'off' } | { k: 'error' } | { k: 'expired' } | { k: 'ok'; p: ProfileData }
type Note = { tone: 'ok' | 'bad' | 'warn'; text: string } | null

const REFRESH_MIN_GAP_MS = 10_000
const ERASE_SENT: Note = {
  tone: 'ok',
  text: `Запрос отправлен. Поддержка удалит данные и сообщит в @${SUPPORT_BOT_HANDLE}, если понадобится уточнение.`,
}
const CHANGED_TEXT = 'Данные обновились. Повторите действие, пожалуйста.'

function whenLabel(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

export function CabinetProfile() {
  const { session: s, logout } = useCabinet()
  const until = untilShort(s.keyExpiresAt)
  const expiredState = s.state === 'expired'
  let term: string | null = null
  if (expiredState) term = 'срок закончился'
  else if (until) term = s.demo ? `демо до ${until}` : `до ${until}`
  else if (s.demo) term = 'демо'

  const ident = profileIdent(s)
  const identRef = useRef(ident)
  identRef.current = ident

  const [load, setLoad] = useState<Load>({ k: 'loading' })
  const loadRef = useRef<Load>(load)
  loadRef.current = load
  const [stale, setStale] = useState(false)
  const [emailNote, setEmailNote] = useState<Note>(null)
  const [nameNote, setNameNote] = useState<Note>(null)
  const [eraseNote, setEraseNote] = useState<Note>(null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [eraseStep, setEraseStep] = useState<'idle' | 'confirm' | 'sent'>('idle')

  const alive = useRef(true)
  const seq = useRef(0) // номер последнего перечитывания: ответы прежних отбрасываются
  const lastAt = useRef(0)
  const loadedIdent = useRef<string | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const reload = useCallback(async () => {
    const my = ++seq.current
    const id = identRef.current
    lastAt.current = Date.now()
    const r = await profileApi.get()
    if (!alive.current || my !== seq.current || id !== identRef.current) return
    if (!r.ok) {
      if (r.status === 404) { setLoad({ k: 'off' }); return }
      if (r.code === 'key_expired') { setLoad({ k: 'expired' }); return }
      // Загруженное не стираем: последние данные + пометка.
      if (loadRef.current.k === 'ok') setStale(true)
      else setLoad({ k: 'error' })
      return
    }
    const d = r.data
    // Только явное «available:true» с разобранным телом; прочее — как выключенная ось.
    if (!d || d.available !== true || typeof d.pending !== 'boolean') { setLoad({ k: 'off' }); return }
    loadedIdent.current = id
    setProfileNameCache(id, d.contact?.name ?? null)
    setStale(false)
    setLoad({ k: 'ok', p: d })
  }, [])

  // Смена ключа (или выход) — чужие данные не показываем и не пишем под новым ключом.
  useEffect(() => {
    seq.current++
    loadedIdent.current = null
    setLoad({ k: 'loading' })
    setStale(false)
    setEmailNote(null); setNameNote(null); setEraseNote(null)
    setEmailOpen(false); setEraseStep('idle')
    void reload()
  }, [ident, expiredState, reload])

  const pending = load.k === 'ok' && load.p.pending
  // Адрес могли подтвердить в другой вкладке: пока ждём — перечитываем при возврате на вкладку.
  useEffect(() => {
    if (!pending) return
    const onBack = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastAt.current < REFRESH_MIN_GAP_MS) return
      void reload()
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => { window.removeEventListener('focus', onBack); document.removeEventListener('visibilitychange', onBack) }
  }, [pending, reload])

  const off = useCallback(() => setLoad({ k: 'off' }), [])
  // Ключ, под которым загружены данные, должен совпадать с текущим.
  const writeCtx = useCallback((): string | null => {
    if (loadedIdent.current === identRef.current) return identRef.current
    void reload()
    return null
  }, [reload])
  // Запрос на удаление не зависит от загруженного профиля (его чтение могло упасть).
  const eraseCtx = useCallback((): string | null => identRef.current, [])
  const current = useCallback((id: string) => alive.current && identRef.current === id, [])

  const expired = load.k === 'expired'

  return (
    <>
      <div className="ph">
        <span className="mono">Профиль</span>
        <h1>Профиль</h1>
      </div>
      <div className="prof">
        {stale && <p className="hint prof-stale" role="status">Не удалось обновить данные — показаны последние.</p>}
        {expired && (
          <div className="prow">
            <span className="lbl">Почта</span>
            <div className="val">
              <div className="line">
                {/* Каркас уже пишет «Срок действия ключа закончился» при истёкшем снимке — не дублируем. */}
                <span className="mute">{expiredState ? 'недоступно, пока ключ не продлён' : 'Срок действия ключа закончился'}</span>
                <a className="btn sm" href={RENEW_HREF}>Продлить</a>
              </div>
            </div>
          </div>
        )}
        {!expired && load.k === 'error' && (
          <>
            <div className="prow"><span className="lbl">Почта</span><div className="val"><span className="mute">временно недоступно</span></div></div>
            <div className="prow"><span className="lbl">Как к Вам обращаться</span><div className="val"><span className="mute">временно недоступно</span></div></div>
          </>
        )}
        {!expired && load.k === 'ok' && (
          <>
            <EmailRow p={load.p} open={emailOpen} setOpen={setEmailOpen} note={emailNote} setNote={setEmailNote}
              reload={reload} writeCtx={writeCtx} current={current} onOff={off} />
            <NameRow p={load.p} note={nameNote} setNote={setNameNote} reload={reload} writeCtx={writeCtx} current={current}
              onOff={off} needEmail={() => setEmailOpen(true)} />
          </>
        )}
        <div className="prow">
          <span className="lbl">Ключ</span>
          <div className="val">
            <div className="line">
              {s.keyPrefix && <span className="mono-v">{s.keyPrefix}…</span>}
              {term && <span className="mute">{term}</span>}
              {(term || s.demo) && <a className="btn sm" href={RENEW_HREF}>Продлить</a>}
            </div>
          </div>
        </div>
        {(load.k === 'ok' || load.k === 'error') && (
          <EraseRow step={eraseStep} setStep={setEraseStep} note={eraseNote} setNote={setEraseNote} writeCtx={eraseCtx} current={current} onOff={off} />
        )}
        {expired && (
          <div className="prow danger">
            <span className="lbl">Данные</span>
            <div className="val"><p className="hint">Чтобы удалить данные, напишите в @{SUPPORT_BOT_HANDLE}</p></div>
          </div>
        )}
      </div>
      <button type="button" className="btn prof-out" onClick={logout}><CabI.out />Выход</button>
    </>
  )
}

interface RowCtx {
  reload: () => Promise<void>
  writeCtx: () => string | null
  current: (id: string) => boolean
  onOff: () => void
}

// NoteView — итог действия; при focus переводит на себя фокус (экранный диктор
// и клавиатура не остаются на закрывшейся форме).
function NoteView({ n, id, focus }: { n: Note; id?: string; focus?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (n && focus) ref.current?.focus() }, [n, focus])
  if (!n) return null
  return (
    <p ref={ref} id={id} tabIndex={-1} className={'hint' + (n.tone === 'bad' ? ' bad' : '')} role={n.tone === 'bad' ? 'alert' : 'status'}>{n.text}</p>
  )
}

function EmailRow({ p, open, setOpen, note, setNote, reload, writeCtx, current, onOff }:
  { p: ProfileData; open: boolean; setOpen: (v: boolean) => void; note: Note; setNote: (n: Note) => void } & RowCtx) {
  const contact = p.contact ?? null
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const emailRef = useRef<HTMLInputElement>(null)

  // Закрытие (отмена, успех, неоднозначный исход) стирает введённое, в т.ч. согласие.
  useEffect(() => { if (!open) { setEmail(''); setName(''); setConsent(false); setForceConsent(false) } }, [open])
  useEffect(() => { if (open) emailRef.current?.focus() }, [open])

  const nameLen = runeLen(name.trim())
  const nameBad = nameLen > NAME_MAX_RUNES
  const [forceConsent, setForceConsent] = useState(false)
  const needConsent = contact === null || forceConsent
  const canSend = email.trim() !== '' && !nameBad && (!needConsent || consent) && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Охрана и тут: кнопка отключена, но submit можно вызвать Enter-ом.
    if (inFlight.current || !canSend) return
    const id = writeCtx()
    if (id === null) { setNote({ tone: 'warn', text: CHANGED_TEXT }); return }
    inFlight.current = true
    setBusy(true)
    setNote(null)
    const body: { email: string; name?: string; consent_version?: string } = { email: email.trim() }
    if (contact === null && name.trim() !== '') body.name = name.trim()
    if (needConsent) body.consent_version = PROFILE_CONSENT_VERSION
    const r = await profileApi.changeEmail(body)
    inFlight.current = false
    setBusy(false)
    if (!current(id)) return
    if (r.ok) {
      setOpen(false)
      setForceConsent(false)
      if (r.data.unchanged) setNote({ tone: 'ok', text: 'Этот адрес уже подтверждён.' })
      else setNote({
        tone: 'ok',
        text: `Мы отправили письмо на ${r.data.pending_email_masked ?? 'новый адрес'}. Откройте ссылку из письма, чтобы подтвердить адрес. Ссылка действует 24 часа.`,
      })
      await reload()
      return
    }
    if (r.status === 404 && r.code === 'profile_unavailable') { onOff(); return }
    // Письмо могло уйти: форму закрываем (не просим второй раз сразу), перечитываем
    // состояние (там может быть «ждём подтверждения»), автоповтора нет.
    if (isMailAmbiguous(r)) {
      setOpen(false)
      setNote({ tone: 'warn', text: MAIL_AMBIGUOUS_TEXT })
      await reload()
      return
    }
    // Согласие/контакт устарели: читаем профиль заново, форма остаётся открытой уже с нужными полями.
    if (r.code === 'consent_required' || r.code === 'consent_invalid') {
      setForceConsent(true)
      setConsent(false)
      setNote({ tone: 'bad', text: 'Подтвердите согласие и отправьте ещё раз.' })
      setOpen(true)
      await reload()
      return
    }
    setNote({ tone: 'bad', text: profileErrorText(r, 'email') })
  }

  const pendingWhen = whenLabel(p.pending_expires_at)
  const pendingLine = p.pending
    ? `${contact ? 'Ждём подтверждения нового адреса' : 'Ждём подтверждения адреса'}${pendingWhen ? ` до ${pendingWhen}` : ''}`
    : null
  const emailBad = note?.tone === 'bad' && open

  return (
    <div className="prow">
      <span className="lbl">Почта</span>
      <div className="val">
        {contact && (
          <div className="line">
            <span className="mono-v mail-v">{contact.email_masked}</span>
            <span className={'tag' + (contact.email_verified ? ' acc' : '')}>{contact.email_verified ? 'подтверждена' : 'не подтверждена'}</span>
          </div>
        )}
        {contact && !contact.email_verified && !p.pending && (
          <p className="hint">Чтобы подтвердить, введите адрес ещё раз — мы пришлём письмо.</p>
        )}
        {!contact && !p.pending && <span className="mute">не указана</span>}
        {pendingLine && <p className="hint" role="status">{pendingLine}</p>}
        {!open && (
          <div className="acts">
            <button type="button" className="btn sm" onClick={() => { setOpen(true); setNote(null) }}>
              {contact ? 'Изменить' : 'Указать почту'}
            </button>
          </div>
        )}
        {open && (
          <form className="form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="prof-email">{contact ? 'Новая почта' : 'Почта'}</label>
              <div className="inp"><input id="prof-email" ref={emailRef} type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off"
                spellCheck={false} maxLength={254} value={email} disabled={busy} aria-invalid={emailBad || undefined}
                aria-describedby={note ? 'prof-email-note' : undefined} onChange={e => setEmail(e.target.value)} /></div>
            </div>
            {needConsent && (
              <>
                {contact === null && (
                <div className="field">
                  <label htmlFor="prof-name-new">Как к Вам обращаться (необязательно)</label>
                  <div className={'inp' + (nameBad ? ' bad' : '')}><input id="prof-name-new" type="text" autoComplete="name" value={name} disabled={busy}
                    aria-invalid={nameBad || undefined} aria-describedby={nameBad ? 'prof-name-new-hint' : undefined}
                    onChange={e => setName(e.target.value)} /></div>
                  {nameBad && <p id="prof-name-new-hint" className="hint bad" role="alert">Не больше {NAME_MAX_RUNES} символов.</p>}
                </div>
                )}
                <label className="cons">
                  <input type="checkbox" checked={consent} disabled={busy} aria-describedby="prof-consent-hint" onChange={e => setConsent(e.target.checked)} />
                  <span>{PROFILE_CONSENT_TEXT}</span>
                </label>
                {!consent && <p id="prof-consent-hint" className="hint">Поставьте галочку согласия — без неё письмо не отправится.</p>}
              </>
            )}
            {contact && <p className="hint">Письмо придёт на новый адрес. Пока Вы не откроете ссылку, остаётся прежняя почта.</p>}
            <div className="acts">
              <button type="submit" className="btn primary sm" disabled={!canSend}>{busy ? 'Отправляем…' : 'Отправить письмо'}</button>
              <button type="button" className="btn sm" disabled={busy} onClick={() => { setOpen(false); setNote(null) }}>Отмена</button>
            </div>
          </form>
        )}
        <NoteView n={note} id="prof-email-note" focus={!open} />
      </div>
    </div>
  )
}

function NameRow({ p, note, setNote, reload, writeCtx, current, onOff, needEmail }:
  { p: ProfileData; note: Note; setNote: (n: Note) => void; needEmail: () => void } & RowCtx) {
  const contact = p.contact ?? null
  const saved = contact?.name ?? ''
  const [name, setName] = useState(saved)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  // Имя пришло с сервера позже (после подтверждения почты / перечитывания).
  useEffect(() => { setName(saved) }, [saved])

  const len = runeLen(name.trim())
  const tooLong = len > NAME_MAX_RUNES
  const canSave = contact !== null && len > 0 && !tooLong && name.trim() !== saved && !busy

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current || !canSave) return
    const id = writeCtx()
    if (id === null) { setNote({ tone: 'warn', text: CHANGED_TEXT }); return }
    inFlight.current = true
    setBusy(true)
    setNote(null)
    const r = await profileApi.saveName(name.trim())
    inFlight.current = false
    setBusy(false)
    if (!current(id)) return
    if (r.ok) { setNote({ tone: 'ok', text: 'Сохранено' }); await reload(); return }
    if (r.status === 404 && r.code === 'profile_unavailable') { onOff(); return }
    if (r.code === 'contact_required') {
      setNote({ tone: 'bad', text: profileErrorText(r, 'name') })
      needEmail()
      await reload()
      return
    }
    setNote({ tone: 'bad', text: profileErrorText(r, 'name') })
  }

  const hint = contact !== null ? null
    : p.pending ? 'Имя появится после подтверждения почты.' : 'Сначала укажите почту.'
  return (
    <div className="prow">
      <span className="lbl">Как к Вам обращаться</span>
      <div className="val">
        <form className="form" onSubmit={save} noValidate>
          <div className={'inp' + (tooLong ? ' bad' : '')}>
            <input aria-label="Как к Вам обращаться" type="text" autoComplete="name" value={name} disabled={contact === null || busy}
              aria-invalid={tooLong || undefined} aria-describedby={tooLong ? 'prof-name-hint' : hint ? 'prof-name-info' : undefined}
              onChange={e => { setName(e.target.value); setNote(null) }} />
          </div>
          {tooLong && <p id="prof-name-hint" className="hint bad" role="alert">Не больше {NAME_MAX_RUNES} символов.</p>}
          {hint && <p id="prof-name-info" className="hint">{hint}</p>}
          {contact !== null && (
            <div className="acts"><button type="submit" className="btn sm" disabled={!canSave}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div>
          )}
          <NoteView n={note} />
        </form>
      </div>
    </div>
  )
}

function EraseRow({ step, setStep, note, setNote, writeCtx, current, onOff }:
  { step: 'idle' | 'confirm' | 'sent'; setStep: (s: 'idle' | 'confirm' | 'sent') => void; note: Note; setNote: (n: Note) => void } & Omit<RowCtx, 'reload'>) {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const confirmRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (step === 'confirm') confirmRef.current?.focus() }, [step])

  async function send() {
    if (inFlight.current) return
    const id = writeCtx()
    if (id === null) { setStep('idle'); setNote({ tone: 'warn', text: CHANGED_TEXT }); return }
    inFlight.current = true
    setBusy(true)
    setNote(null)
    const r = await profileApi.erase()
    inFlight.current = false
    setBusy(false)
    if (r.ok) invalidatePlacement() // запрос удаления стирает и файл теста: сводка устарела
    if (!current(id)) return
    if (r.ok) { setStep('sent'); return }
    if (r.status === 404 && r.code === 'profile_unavailable') { onOff(); return }
    setStep('idle')
    setNote({ tone: 'bad', text: profileErrorText(r, 'erase') })
  }

  return (
    <div className="prow danger">
      <span className="lbl">Данные</span>
      <div className="val">
        {step === 'sent' ? (
          <NoteView n={ERASE_SENT} focus />
        ) : step === 'confirm' ? (
          <div role="alertdialog" aria-labelledby="prof-erase-q" ref={confirmRef} tabIndex={-1}>
            <p id="prof-erase-q">Мы удалим Вашу почту, имя и привязку Telegram. Ключ и маршрут останутся. Отправить запрос?</p>
            <div className="acts">
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => void send()}>{busy ? 'Отправляем…' : 'Отправить запрос'}</button>
              <button type="button" className="btn sm" disabled={busy} onClick={() => setStep('idle')}>Отмена</button>
            </div>
          </div>
        ) : (
          <>
            <NoteView n={note} focus />
            <div className="acts"><button type="button" className="btn sm" onClick={() => { setNote(null); setStep('confirm') }}>Удалить мои данные</button></div>
          </>
        )}
      </div>
    </div>
  )
}
