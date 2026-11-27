// ModulesPage.tsx — /modules, каталог модулей Flibooster (спека 2026-11-06, §8).
// Аноним видит публичные модули; ключ открывает остальные. Двойное чтение
// (спека кабинета 2026-11-17 §3.6): ключ старого окна flib:tpk — в теле, как
// раньше; иначе активная сессия кабинета — POST {} (ключ из cookie на BFF);
// иначе анонимный GET. Скрытые модули BFF не отдаёт никому.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { loadKey } from './access'
import { getSession, isActiveSession, refreshSession } from './session'
import { useSession } from './useSession'
import {
  fetchCatalog, fetchKeyedIcon, startDownload,
  type CatalogModule, type ModuleVersion, type CatalogResult, type ModulesAuth,
} from './modules-api'

// Единая точка для подсказки по ручной установке; текст задан владельцем.
export const MODULES_INSTALL_HINT = {
  intro: 'Распакуйте zip в папку <папка модулей>/<id>/, чтобы manifest.json лежал прямо в ней, и перезапустите Flibooster. Сам zip класть нельзя: программа его не читает.',
  folders: [
    { os: 'Windows', path: '%APPDATA%\\Flibooster\\modules' },
    { os: 'Linux', path: '~/.config/anki-connect-desktop/modules' },
    { os: 'macOS', path: '~/Library/Application Support/Flibooster/modules' },
  ],
  after: 'После запуска модуль появится в Настройках → Модули и спросит согласие. Общий выключатель «Сторонние модули» должен быть включён.',
}

const PLATFORM_LABEL: Record<string, string> = {
  any: 'любая', 'win-x64': 'Windows', 'linux-x64': 'Linux', 'darwin-arm64': 'macOS (Apple)', 'darwin-x64': 'macOS (Intel)',
}

function fmtSize(n?: number): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}

// Предлагаем только не отозванные версии; берём новейшую (список приходит
// отсортированным) и все её платформы.
export function offeredVersions(m: CatalogModule): ModuleVersion[] {
  const live = (m.versions ?? []).filter(v => !v.yanked)
  if (live.length === 0) return []
  return live.filter(v => v.version === live[0].version)
}

function ModuleIcon({ m, auth }: { m: CatalogModule; auth: ModulesAuth }) {
  const ref = (m.versions ?? []).find(v => !v.yanked && v.icon)?.icon
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!ref) return
    if (!auth) { setSrc(ref.url); return }
    const ctl = new AbortController()
    let made: string | null = null
    fetchKeyedIcon(ref.url, auth, ctl.signal).then(u => {
      made = u
      if (!ctl.signal.aborted) setSrc(u); else if (u) URL.revokeObjectURL(u)
    })
    return () => { ctl.abort(); if (made) URL.revokeObjectURL(made) }
  }, [ref?.url, auth])
  if (!ref || !src) return <div className="mod-icon mod-icon-empty" aria-hidden="true" />
  return <img className="mod-icon" src={src} alt="" width={56} height={56} />
}

function ModuleCard({ m, auth }: { m: CatalogModule; auth: ModulesAuth }) {
  const offered = offeredVersions(m)
  const [err, setErr] = useState<string | null>(null)
  const changelog = offered.find(v => v.changelog)?.changelog
  return (
    <div className={`mod-card ${m.accessible ? '' : 'mod-locked'}`}>
      <ModuleIcon m={m} auth={auth} />
      <div className="mod-body">
        <h3>{m.name} {!m.accessible && <span className="mod-lock">🔒 Нужен доступ</span>}</h3>
        <p>{m.description}</p>
        {offered.length > 0 && (
          <div className="mono faint">
            версия {offered[0].version}
            {offered.some(v => v.size) && ` · ${offered.map(v => fmtSize(v.size)).filter(Boolean)[0]}`}
          </div>
        )}
        {changelog && <p className="mod-changelog">{changelog}</p>}
        {m.accessible && offered.length > 0 && (
          <div className="mod-actions">
            {offered.map(v => (
              <button
                key={v.platform}
                type="button"
                className="btn btn-amber"
                onClick={async () => setErr(await startDownload(auth, m.id, v.version, v.platform))}
              >
                Скачать · {PLATFORM_LABEL[v.platform] ?? v.platform}
              </button>
            ))}
          </div>
        )}
        {m.accessible && offered.length === 0 && <div className="mono faint">Нет доступных версий</div>}
        {err && <div className="mod-err">Не удалось скачать: {err}</div>}
      </div>
    </div>
  )
}

// Порядок (спека §3.6): при cabinet:true активная сессия идёт первой (ключ
// сессии не держим в памяти страницы, ревью C-1); при cabinet:false (откат) —
// ключ старого окна, как до кабинета; затем активная сессия; затем аноним.
function initialAuth(): ModulesAuth {
  const s = getSession()
  if (isActiveSession(s) && s.cabinet) return 'session'
  const legacy = loadKey()
  if (legacy) return { key: legacy }
  return isActiveSession(s) ? 'session' : null
}

export function ModulesPage() {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const [state, setState] = useState<'loading' | 'ok' | 'off' | 'error'>('loading')
  const [modules, setModules] = useState<CatalogModule[]>([])
  // auth — чем открыт показанный список (иконки и скачивание идут тем же путём);
  // want — чем грузить. Сразу, без ожидания снимка сессии (ревью C-3):
  // активная сессия → путь cookie; иначе ключ старого окна; иначе аноним.
  const [auth, setAuth] = useState<ModulesAuth>(null)
  const [want, setWant] = useState<ModulesAuth>(initialAuth)
  const [keyBad, setKeyBad] = useState(false)
  const session = useSession({ passive: true })
  const sessionActive = isActiveSession(session)

  // Сессия стала активной (перенос, вход в другой вкладке) — страница отпускает
  // сырой ключ и переходит на путь cookie (ревью C-1): ключ сессии не живёт в
  // памяти страницы дольше самого входа. Переключение одно: после отказа
  // ручки модулей по cookie (401) want остаётся 'session', и снимок «active»
  // не гоняет запросы по кругу.
  useEffect(() => {
    if (!sessionActive || want === 'session') return
    // Откат (cabinet:false): ключ старого окна остаётся первым (спека §3.6).
    if (!session.cabinet && want !== null) return
    setWant('session')
    setAuth(a => (a ? 'session' : a))
  }, [sessionActive, session.cabinet, want])

  // flib:tpk стёрли или сменили в другой вкладке (вход, перенос, «Выход»):
  // ключ в памяти страницы отпускаем сразу и выбираем путь заново, а снимок
  // сессии перечитываем. Работает и без BroadcastChannel (Safari 14.0–15.3;
  // ревью раунда 2 R2-C1 (a)).
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== 'flib:tpk' && ev.key !== null) return
      const legacy = loadKey()
      const stale = (x: ModulesAuth) => x !== null && typeof x === 'object' && x.key !== legacy
      setWant(w => (stale(w) ? initialAuth() : w))
      setAuth(x => (stale(x) ? null : x))
      void refreshSession()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    const { signal } = ctl
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = (res: CatalogResult, a: ModulesAuth) => {
      setAuth(a)
      if (res.kind === 'ok') { setModules(res.modules); setState('ok') }
      else if (res.kind === 'off') setState('off')
      else setState('error')
    }
    ;(async () => {
      let key: ModulesAuth = want
      let res = await fetchCatalog(key, signal)
      if (signal.aborted) return
      if (res.kind === 'invalid_key') {
        // Ключ старого окна не подошёл — подсказка; сессия — перечитать её
        // снимок (§3.3: по 401), список — анонимный.
        if (key === 'session') void refreshSession()
        else setKeyBad(true)
        key = null
        res = await fetchCatalog(null, signal)
        if (signal.aborted) return
      } else if (res.kind === 'rate_limited' && key) {
        // min-gap на ключевой ручке: сразу показываем анонимный список,
        // один раз повторяем с ключом после паузы (не короче 2 с).
        const retryMs = Math.max(2, res.retryAfterSec) * 1000
        const anon = await fetchCatalog(null, signal)
        if (signal.aborted) return
        show(anon, null)
        timer = setTimeout(async () => {
          const again = await fetchCatalog(key, signal)
          if (signal.aborted) return
          if (again.kind === 'ok') show(again, key)
        }, retryMs)
        return
      }
      show(res, key)
    })()
    return () => { ctl.abort(); if (timer) clearTimeout(timer) }
  }, [want])

  return (
    <div className="site">
      <div className="view">
        <div className="page">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/">← на главную</Link>
          </div>
          <div className="fork-head">
            <div className="eyebrow">Flibooster</div>
            <h1>Модули</h1>
            <p>Дополнения для приложения. Модули с замком открываются по личному ключу.</p>
          </div>

          {keyBad && <div className="mod-note">Сохранённый ключ не подошёл. Показан открытый список; проверьте ключ через «Войти».</div>}
          {state === 'loading' && <div className="mod-note">Загружаем каталог…</div>}
          {state === 'off' && <div className="mod-note">Магазин модулей выключен.</div>}
          {state === 'error' && <div className="mod-note">Каталог сейчас недоступен. Попробуйте позже.</div>}
          {state === 'ok' && modules.length === 0 && <div className="mod-note">Пока нет ни одного модуля.</div>}
          {state === 'ok' && modules.length > 0 && (
            <div className="mod-list">
              {modules.map(m => <ModuleCard key={m.id} m={m} auth={auth} />)}
            </div>
          )}

          <div className="ext-after">
            <h2>Как поставить модуль</h2>
            <ol className="mod-steps">
              <li>Скачайте zip нужного модуля. Установка из приложения проще: откройте Настройки → Модули.</li>
              <li>
                Для ручной установки: {MODULES_INSTALL_HINT.intro}
                <ul>
                  {MODULES_INSTALL_HINT.folders.map(f => (
                    <li key={f.os}>{f.os}: <code className="mono">{f.path}</code></li>
                  ))}
                </ul>
              </li>
              <li>{MODULES_INSTALL_HINT.after}</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
