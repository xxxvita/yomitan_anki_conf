// ModulesUploadPage.tsx — /modules/upload, загрузка версии модуля прямо на шлюз
// (спека 2026-11-06, §9). Ключ живёт только в состоянии компонента: не в
// localStorage, не в URL; `flib:tpk` не читается и не пишется.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'

const GATEWAY = ((import.meta.env.VITE_MODULES_GATEWAY as string | undefined) || 'https://cache.flib.club').replace(/\/+$/, '')

export const UPLOAD_ERROR_TEXT: Record<string, string> = {
  bad_envelope: 'Файл envelope повреждён или имеет неверный формат.',
  bad_signature: 'Подпись не подходит к envelope. Подпишите заново тем же ключом.',
  unknown_key: 'Ключ издателя, которым подписан envelope, шлюзу неизвестен.',
  key_revoked: 'Ключ издателя отозван. Подпишите другим ключом.',
  key_publisher_mismatch: 'Ключ подписи принадлежит другому издателю, чем указан в envelope.',
  envelope_mismatch: 'Envelope не совпадает с формой: проверьте id модуля, версию и платформу.',
  manifest_mismatch: 'manifest.json внутри zip расходится с envelope (id, версия или требования).',
  digest_mismatch: 'Размер или sha256 архива не совпадают с envelope. Пересоберите и подпишите заново.',
  version_exists: 'Эта версия уже загружена с другим содержимым. Поднимите номер версии.',
  envelope_differs: 'Эта версия уже загружена с другим envelope. Поднимите номер версии.',
  package_too_large: 'Архив слишком большой для загрузки.',
  bad_image: 'Иконка или обложка не подходит: проверьте формат и размер картинки.',
  upload_in_progress: 'Сервер сейчас принимает другую загрузку. Повторите через минуту.',
  upload_idle_timeout: 'Сервер оборвал загрузку: данные перестали поступать. Проверьте соединение и повторите.',
  module_not_found: 'Такого модуля нет. Сначала его должен завести администратор.',
  module_requires_key: 'Для этого модуля нужен ключ.',
  module_upload_forbidden: 'У этого ключа нет права загружать модули.',
}
const NETWORK_TEXT = 'Соединение оборвалось, ответа от сервера нет. Сервер мог отклонить загрузку, не дочитав файл: проверьте ключ и то, что модуль заведён, затем повторите.'

function errorText(status: number, code: string): string {
  if (UPLOAD_ERROR_TEXT[code]) return UPLOAD_ERROR_TEXT[code]
  if (status === 401) return 'Ключ не принят. Проверьте, что он скопирован целиком.'
  if (status === 403) return 'У этого ключа нет права на загрузку модулей.'
  if (status === 404) return 'Модуль не найден или недоступен этому ключу.'
  if (status === 408) return UPLOAD_ERROR_TEXT.upload_idle_timeout
  if (status === 413) return UPLOAD_ERROR_TEXT.package_too_large
  if (status === 429) return UPLOAD_ERROR_TEXT.upload_in_progress
  return `Загрузка не удалась (код ${status}).`
}

interface Env { id?: string; version?: string; platform?: string }

function readBytes(f: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(f)
  })
}

async function parseEnvelope(f: File): Promise<{ bytes: ArrayBuffer; env: Env | null }> {
  const bytes = await readBytes(f)
  try {
    const o = JSON.parse(new TextDecoder().decode(bytes))
    if (o && typeof o === 'object') return { bytes, env: { id: String(o.id ?? ''), version: String(o.version ?? ''), platform: String(o.platform ?? '') } }
  } catch { /* не JSON: шлюз ответит bad_envelope */ }
  return { bytes, env: null }
}

type Result = { kind: 'created' | 'exists'; warnings: string[] } | { kind: 'error'; text: string }

export function ModulesUploadPage() {
  const [key, setKey] = useState('')
  const [id, setId] = useState('')
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState('')
  const [changelog, setChangelog] = useState('')
  const [pkg, setPkg] = useState<File | null>(null)
  const [sig, setSig] = useState<File | null>(null)
  const [icon, setIcon] = useState<File | null>(null)
  const [cover, setCover] = useState<File | null>(null)
  const [envFile, setEnvFile] = useState<File | null>(null)
  const [env, setEnv] = useState<Env | null>(null)
  const [envBad, setEnvBad] = useState(false)
  const envBytes = useRef<ArrayBuffer | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
    const m = document.createElement('meta')
    m.name = 'robots'; m.content = 'noindex'
    document.head.appendChild(m)
    return () => { m.remove() }
  }, [])

  async function onEnvelope(f: File | null) {
    setEnvFile(f); setEnv(null); setEnvBad(false); envBytes.current = null
    if (!f) return
    const { bytes, env: e } = await parseEnvelope(f)
    envBytes.current = bytes
    if (!e) { setEnvBad(true); return }
    setEnv(e)
    if (e.id) setId(e.id)
    if (e.version) setVersion(e.version)
    if (e.platform) setPlatform(e.platform)
  }

  const mismatches: string[] = []
  if (env) {
    if (env.id && id.trim() !== env.id) mismatches.push(`id: в форме «${id.trim()}», в envelope «${env.id}»`)
    if (env.version && version.trim() !== env.version) mismatches.push(`версия: в форме «${version.trim()}», в envelope «${env.version}»`)
    if (env.platform && platform.trim() !== env.platform) mismatches.push(`платформа: в форме «${platform.trim()}», в envelope «${env.platform}»`)
  }
  const ready = !!(key.trim() && id.trim() && version.trim() && platform.trim() && pkg && envFile && sig && envBytes.current)
    && mismatches.length === 0 && !busy

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || !pkg || !envFile || !sig || !envBytes.current) return
    const fd = new FormData()
    fd.append('package', pkg, pkg.name)
    fd.append('envelope', new Blob([envBytes.current], { type: 'application/json' }), envFile.name)
    fd.append('signature', sig, sig.name)
    fd.append('version', version.trim())
    fd.append('platform', platform.trim())
    if (changelog.trim()) fd.append('changelog', changelog)
    if (icon) fd.append('icon', icon, icon.name)
    if (cover) fd.append('cover', cover, cover.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${GATEWAY}/v1/modules/${encodeURIComponent(id.trim())}/versions`)
    xhr.setRequestHeader('Authorization', `Bearer ${key.trim()}`)
    xhr.upload.onprogress = ev => { if (ev.lengthComputable && ev.total > 0) setProgress(Math.round(ev.loaded / ev.total * 100)) }
    xhr.onerror = () => { setBusy(false); setProgress(null); setResult({ kind: 'error', text: NETWORK_TEXT }) }
    xhr.onabort = xhr.onerror
    xhr.ontimeout = xhr.onerror
    xhr.onload = () => {
      setBusy(false); setProgress(null)
      let body: { error?: string; code?: string; warnings?: string[] } = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* не JSON */ }
      if (xhr.status === 201 || xhr.status === 200) {
        setResult({ kind: xhr.status === 201 ? 'created' : 'exists', warnings: Array.isArray(body.warnings) ? body.warnings : [] })
      } else {
        setResult({ kind: 'error', text: errorText(xhr.status, String(body.error ?? body.code ?? '')) })
      }
    }
    setBusy(true); setResult(null); setProgress(0)
    xhr.send(fd)
  }

  return (
    <div className="site">
      <div className="view">
        <div className="page">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/modules">← к модулям</Link>
          </div>
          <div className="fork-head">
            <div className="eyebrow">Для издателей</div>
            <h1>Загрузка версии модуля</h1>
            <p>Файлы уходят прямо на шлюз. Ключ хранится только в этой вкладке и не сохраняется.</p>
          </div>

          <form onSubmit={submit} className="mod-upload">
            <label>Ключ загрузки
              <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} />
            </label>
            <label>Envelope (.envelope.json)
              <input type="file" aria-label="envelope" onChange={e => { void onEnvelope(e.target.files?.[0] ?? null) }} />
            </label>
            {envBad && <p role="alert">Envelope не похож на JSON. Шлюз его всё равно проверит, но id, версию и платформу придётся ввести вручную.</p>}
            <label>Подпись (.sig)
              <input type="file" aria-label="signature" onChange={e => setSig(e.target.files?.[0] ?? null)} />
            </label>
            <label>Архив модуля (zip)
              <input type="file" aria-label="package" onChange={e => setPkg(e.target.files?.[0] ?? null)} />
            </label>
            <label>id модуля
              <input value={id} onChange={e => setId(e.target.value)} />
            </label>
            <label>Версия
              <input value={version} onChange={e => setVersion(e.target.value)} />
            </label>
            <label>Платформа
              <input value={platform} onChange={e => setPlatform(e.target.value)} placeholder="any, win-x64, linux-x64…" />
            </label>
            <label>Что нового (необязательно)
              <textarea value={changelog} onChange={e => setChangelog(e.target.value)} />
            </label>
            <label>Иконка (необязательно)
              <input type="file" aria-label="icon" accept="image/*" onChange={e => setIcon(e.target.files?.[0] ?? null)} />
            </label>
            <label>Обложка (необязательно)
              <input type="file" aria-label="cover" accept="image/*" onChange={e => setCover(e.target.files?.[0] ?? null)} />
            </label>

            {mismatches.length > 0 && (
              <div role="alert" className="mod-upload-mismatch">
                <p>Форма расходится с envelope, отправка заблокирована:</p>
                <ul>{mismatches.map(m => <li key={m}>{m}</li>)}</ul>
              </div>
            )}

            <button type="submit" disabled={!ready}>{busy ? 'Загружаем…' : 'Загрузить'}</button>
            {progress !== null && <progress value={progress} max={100} aria-label="Прогресс загрузки">{progress}%</progress>}
          </form>

          {result?.kind === 'created' && <p role="status">Версия загружена.</p>}
          {result?.kind === 'exists' && <p role="status">Эта версия уже загружена, ничего не изменилось.</p>}
          {result && result.kind !== 'error' && result.warnings.includes('manifest_access_differs') && (
            <p role="status">Предупреждение: доступ в manifest.json отличается от доступа модуля в каталоге. Загрузка прошла.</p>
          )}
          {result?.kind === 'error' && <p role="alert">{result.text}</p>}
        </div>
      </div>
    </div>
  )
}
