// AddTab.tsx — «Добавить» (макет §5): текст или ссылка YouTube → «Распознать» →
// итог → «Добавить все» | «Посмотреть слова» → «Добавлено слов: N».
// Слева форма, справа совет про программу (`.know-grid`, на телефоне — стопкой).
// Файл (аудио/видео) — «скоро»: недоступный пункт, не вкладка.
import { useEffect, useRef, useState } from 'react'
import { DOWNLOAD_PAGE_PATH } from '../../external-links'
import { refreshSession } from '../../session'
import {
  analyze, saveWords, SAVE_BATCH, type NewWord, type SaveSource, type WordKind,
} from './knowledge-api'
import { addHistory, textTitle } from './knowledge-history'
import {
  batches, classifyAnalyze, describeAnalyzeError, describeSaveError, TEXT_MAX_BYTES, utf8Bytes, youtubeVideoId,
  YOUTUBE_LINK_HINT, type Failure,
} from './knowledge-model'
import { ReviewList } from './ReviewList'

type Mode = 'text' | 'youtube'
type Phase =
  | { s: 'idle' }
  | { s: 'analyzing' }
  | { s: 'failed'; failure: Failure }
  | { s: 'no_words' | 'all_known' }
  | { s: 'ready'; words: NewWord[]; source: SaveSource; truncated: boolean; reviewing: boolean; saving: boolean; error: Failure | null }
  | { s: 'saved'; added: number; known: number; already: number; skipped: number }

function FailureView({ f, onRetry }: { f: Failure; onRetry?: () => void }) {
  return (
    <div className="msg err" role="alert" data-testid={`kn-failed-${f.code}`}>
      <div>
        <p>{f.text}</p>
        <div className="kn-actions">
          {f.offerApp && <a className="btn primary" data-testid="kn-download" href={DOWNLOAD_PAGE_PATH}>Скачать Flibooster</a>}
          {f.retry && onRetry && <button type="button" className="btn sm" data-testid="kn-retry" onClick={onRetry}>Повторить</button>}
        </div>
      </div>
    </div>
  )
}

const kindsOf = (words: NewWord[], lemmas: string[]): Record<string, WordKind> => {
  const pick = new Set(lemmas)
  const out: Record<string, WordKind> = {}
  for (const w of words) if (pick.has(w.lemma) && (w.kind === 'phrase' || w.kind === 'idiom')) out[w.lemma] = w.kind
  return out
}

export function AddTab({ keyPrefix, onSaved }: { keyPrefix: string; onSaved: () => void }) {
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>({ s: 'idle' })
  const alive = useRef(true)
  const inflight = useRef(false)
  const token = useRef(0) // запрос, чей ответ ещё нужен: сброс/новый ввод делают поздний ответ ненужным
  useEffect(() => { alive.current = true; return () => { alive.current = false; token.current++ } }, [])

  const busy = phase.s === 'analyzing' || (phase.s === 'ready' && phase.saving)
  const videoId = youtubeVideoId(url)
  const urlBad = mode === 'youtube' && url.trim().length > 0 && !videoId
  const input = mode === 'text' ? text : url
  const ready = input.trim().length > 0 && !busy && !urlBad

  const reset = () => { token.current++; setPhase({ s: 'idle' }) }
  const clearResult = () => { if (phase.s === 'failed' || phase.s === 'saved' || phase.s === 'no_words' || phase.s === 'all_known') reset() }

  async function run() {
    if (inflight.current || !input.trim()) return
    if (mode === 'text' && utf8Bytes(text) > TEXT_MAX_BYTES) {
      setPhase({ s: 'failed', failure: describeAnalyzeError({ ok: false, status: 413, code: 'text_too_large', retryAfterSec: null, cls: 'other', body: null }) })
      return
    }
    if (mode === 'youtube' && !videoId) return
    inflight.current = true
    const my = ++token.current
    setPhase({ s: 'analyzing' })
    const source: SaveSource = mode === 'text'
      ? { kind: 'text', title: textTitle(text) }
      : { kind: 'youtube', title: `YouTube · ${videoId}`, video_id: videoId as string }
    const r = await analyze(mode === 'text' ? { text } : { youtube_url: url.trim() })
    inflight.current = false
    if (!alive.current || my !== token.current) return // страницу закрыли или ввод сбросили — ответ не нужен
    if (!r.ok) {
      const failure = describeAnalyzeError(r)
      if (failure.session) void refreshSession().catch(() => undefined)
      setPhase({ s: 'failed', failure })
      return
    }
    const c = classifyAnalyze(r.data)
    if (c.s === 'ready') setPhase({ s: 'ready', words: c.words, source, truncated: r.data.truncated === true, reviewing: false, saving: false, error: null })
    else setPhase({ s: c.s })
  }

  async function save(lemmas: string[]) {
    if (phase.s !== 'ready' || phase.saving || inflight.current) return
    const { source, words, truncated } = phase
    const kinds = kindsOf(words, lemmas)
    inflight.current = true
    const my = ++token.current
    setPhase({ ...phase, saving: true, error: null })
    let added = 0
    let known = 0
    let skipped = 0
    const record = () => addHistory(keyPrefix, {
      kind: source.kind, title: source.title, ...(source.video_id ? { video_id: source.video_id } : {}),
      at: new Date().toISOString(), added,
    })
    for (const part of batches(lemmas, SAVE_BATCH)) {
      const r = await saveWords(part, source, kinds)
      if (!r.ok) {
        inflight.current = false
        const failure = describeSaveError(r)
        if (failure.session) void refreshSession().catch(() => undefined)
        // Часть слов уже в словаре — это часть источника, ему место в истории.
        if (added > 0) { record(); onSaved() }
        // Повтор безопасен: слова, уже ушедшие в словарь, сервер пропускает.
        if (alive.current && my === token.current) setPhase({ s: 'ready', words, source, truncated, reviewing: phase.reviewing, saving: false, error: failure })
        return
      }
      added += r.data.added
      skipped += r.data.skipped ?? 0
      known = r.data.total
    }
    inflight.current = false
    record()
    onSaved()
    if (alive.current && my === token.current) setPhase({ s: 'saved', added, known, skipped, already: Math.max(0, lemmas.length - added - skipped) })
  }

  return (
    <div className="know-grid">
      <div className="add-box kn-add">
        <div className="seg" role="group" aria-label="Что добавить">
          <button type="button" aria-pressed={mode === 'text'} className={mode === 'text' ? 'on' : ''} data-testid="kn-mode-text" disabled={busy} onClick={() => { setMode('text'); reset() }}>Текст</button>
          <button type="button" aria-pressed={mode === 'youtube'} className={mode === 'youtube' ? 'on' : ''} data-testid="kn-mode-youtube" disabled={busy} onClick={() => { setMode('youtube'); reset() }}>Ссылка YouTube</button>
          <button type="button" className="soon" data-testid="kn-mode-file" disabled title="Скоро">Аудио / видео · скоро</button>
        </div>
        <p className="mute kn-lead">Материал, который Вы уже понимаете на слух: слова из него станут известными.</p>

        {mode === 'text' ? (
          <textarea className="kn-text" data-testid="kn-text" rows={8} value={text} placeholder="Вставьте английский текст…" aria-label="Английский текст" disabled={phase.s === 'analyzing'}
            onChange={e => { setText(e.target.value); clearResult() }} />
        ) : (
          <>
            <div className="inp kn-url">
              <input type="url" inputMode="url" data-testid="kn-url" value={url} placeholder="Ссылка на ролик YouTube" aria-label="Ссылка на ролик YouTube" aria-invalid={urlBad || undefined}
                aria-describedby={urlBad ? 'kn-url-hint' : undefined} disabled={phase.s === 'analyzing'}
                onChange={e => { setUrl(e.target.value); clearResult() }}
                onKeyDown={e => { if (e.key === 'Enter' && ready) void run() }} />
            </div>
            {urlBad && <p className="mute kn-url-hint" id="kn-url-hint" data-testid="kn-url-hint">{YOUTUBE_LINK_HINT}</p>}
          </>
        )}

        {(phase.s === 'idle' || phase.s === 'failed' || phase.s === 'analyzing' || phase.s === 'no_words' || phase.s === 'all_known' || phase.s === 'saved') && (
          <div className="kn-actions">
            <button type="button" className="btn primary" data-testid="kn-run" disabled={!ready} onClick={() => void run()}>
              {phase.s === 'analyzing' ? <><span className="spin" />Распознаём</> : 'Распознать'}
            </button>
          </div>
        )}

        <div aria-live="polite" className="kn-live">
          {phase.s === 'analyzing' && <span className="kn-sr">Распознаём слова, это может занять до полутора минут</span>}
          {phase.s === 'failed' && <FailureView f={phase.failure} onRetry={phase.failure.retry ? () => void run() : undefined} />}
          {phase.s === 'no_words' && <div className="kn-card" data-testid="kn-no-words"><p>В материале не нашлось английских слов</p></div>}
          {phase.s === 'all_known' && <div className="kn-card" data-testid="kn-all-known"><p>Все слова этого материала Вы уже знаете</p></div>}

          {phase.s === 'ready' && (
            <div className="kn-card" data-testid="kn-ready">
              <h2 className="kn-found">Найдено новых слов: <b data-testid="kn-count">{phase.words.length}</b></h2>
              {phase.truncated && <p className="mute" data-testid="kn-truncated">Ролик очень длинный: разобрана только его начальная часть (до 200 КБ субтитров). Остальное удобнее загрузить в программе Flibooster.</p>}
              {phase.saving && <p className="mute" data-testid="kn-saving"><span className="spin kn-spin" />Добавляем…</p>}
              {phase.error && <FailureView f={phase.error} />}
              {!phase.reviewing ? (
                <div className="kn-actions">
                  <button type="button" className="btn primary" data-testid="kn-add-all" disabled={phase.saving} onClick={() => void save(phase.words.map(w => w.lemma))}>Добавить все</button>
                  <button type="button" className="btn" data-testid="kn-review" disabled={phase.saving} onClick={() => setPhase({ ...phase, reviewing: true })}>Посмотреть слова</button>
                  <button type="button" className="btn" data-testid="kn-discard" disabled={phase.saving} onClick={reset}>Добавить ещё материал</button>
                </div>
              ) : (
                <ReviewList words={phase.words} busy={phase.saving} onSave={l => void save(l)} onDiscard={reset} />
              )}
            </div>
          )}

          {phase.s === 'saved' && (
            <div className="msg ok" data-testid="kn-saved">
              <div>
                <p>Добавлено слов: <b>{phase.added}</b>{phase.known > 0 && <> · Известно слов: <b data-testid="kn-known-total">{phase.known.toLocaleString('ru-RU')}</b></>}</p>
                {phase.already > 0 && <p className="mute">Уже были в словаре: {phase.already}</p>}
                {phase.skipped > 0 && <p className="mute" data-testid="kn-skipped">Не добавлено (необычная запись): {phase.skipped}</p>}
                <div className="kn-actions"><button type="button" className="btn sm" data-testid="kn-again" onClick={() => { setText(''); setUrl(''); reset() }}>Добавить ещё материал</button></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className="hint" data-testid="kn-hint">
        <p>С длинными видео и аудиокнигами удобнее в программе Flibooster.</p>
        <a className="btn sm" href={DOWNLOAD_PAGE_PATH}>Скачать Flibooster</a>
      </aside>
    </div>
  )
}
