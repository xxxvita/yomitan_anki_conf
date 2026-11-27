// ImportPage.tsx — /import, «Загрузить словарь»: точка А из файла.
//
// Порт temp/flib/fork.jsx:143-185 (ImportSetup). Разбор файла — чистая
// функция parse-vocab.ts (тестируется отдельно, TDD). Прототип поддерживал
// Anki .apkg в списке форматов на вид, но парсер их не читает (это бинарный
// SQLite-контейнер, не текст) — тут список форматов честно ограничен тем,
// что parseVocabFile реально понимает: known-words.json/JSON-массив/txt/csv.
// Дропзона в прототипе была голым `<div style={...} onClick>` — недоступна с
// клавиатуры и не принимала реальный drag-n-drop. Здесь это `<label>` вокруг
// настоящего `<input type="file">` (скрыт визуально классом .import-input,
// но остаётся в таб-порядке и открывается по Enter/Space — нативное
// поведение input, без ручного keydown), плюс обработчики onDrop/onDragOver.
//
// Чтение файла — через FileReader, не File.text(): jsdom (тестовая среда,
// см. web/vitest.setup.ts) реализует File/Blob без .text() (добавлено в
// jsdom только с 27.x, здесь 25.x) — FileReader.readAsText работает
// одинаково что в реальном браузере, что в jsdom, без мока в тестах.
//
// Э3 п.4б: импорт словами (kind='words') сам по себе не несёт цели, а
// маршруту она нужна (goal_ids в POST /api/route, см. api.ts) — тот же
// GoalChips, что и TryPage.tsx, только на STATIC_GOALS (задача не требует
// живого каталога здесь, см. GoalChips.tsx). Кнопка требует и слова, и ≥1 цель.
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { STATIC_GOALS } from './data'
import { GoalChips } from './GoalChips'
import { parseVocabFile, type ParseVocabResult } from './parse-vocab'
import { savePointA } from './pointA'
import { INTERESTS } from './data'
import { plural } from './plural'

const PREVIEW_LIMIT = 20

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('file read error'))
    reader.readAsText(file)
  })
}

export function ImportPage() {
  const navigate = useNavigate()
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<ParseVocabResult | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [goals, setGoals] = useState<string[]>([])
  const [interests, setInterests] = useState<string[]>([])

  function toggleGoal(id: string) {
    setGoals(prev => (prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]))
  }

  async function handleFile(file: File) {
    setFileName(file.name)
    try {
      const text = await readFileAsText(file)
      setResult(parseVocabFile(text, file.name))
    } catch {
      setResult({ words: [], errors: ['Не удалось прочитать файл'] })
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const canSubmit = Boolean(result && result.words.length > 0) && goals.length > 0

  function handleSubmit() {
    if (!canSubmit || !result) return
    savePointA({ kind: 'words', words: result.words, goals, interests, source: 'upload', savedAt: new Date().toISOString() })
    navigate('/route')
  }

  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/fork">← назад к вариантам</Link>
          </div>

          <div className="fork-head" style={{ marginBottom: 30 }}>
            <div className="eyebrow">Загрузить словарь</div>
            <h1>Отдайте, что уже знаете</h1>
          </div>

          <div className="setup-card">
            <label
              className={`import-drop${dragActive ? ' drag' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".json,.txt,.csv"
                className="import-input"
                aria-label="Загрузить файл словаря"
                onChange={handleInputChange}
              />
              <div className="id-ico">{result ? '✓' : '↓'}</div>
              <div className="serif id-title">{fileName ?? 'Перетащите файл сюда или выберите на диске'}</div>
              <div className="setup-note" style={{ marginTop: 8 }}>known-words.json · JSON-массив слов · .txt / .csv</div>
            </label>

            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              {['known-words.json', '.txt', '.csv'].map(s => (
                <span key={s} className="chip" style={{ cursor: 'default' }}>{s}</span>
              ))}
            </div>

            {result && (
              <div className="import-preview">
                <div className={`import-count${result.errors.length > 0 ? ' has-errors' : ''}`}>
                  {result.words.length > 0
                    ? `✓ Распознано ${result.words.length} ${plural(result.words.length, 'слово', 'слова', 'слов')}`
                    : 'Слова не распознаны'}
                </div>
                {result.words.length > 0 && (
                  <div className="chip-row import-chips">
                    {result.words.slice(0, PREVIEW_LIMIT).map(w => (
                      <span key={w} className="chip" style={{ cursor: 'default' }}>{w}</span>
                    ))}
                    {result.words.length > PREVIEW_LIMIT && (
                      <span className="chip faint" style={{ cursor: 'default' }}>+{result.words.length - PREVIEW_LIMIT} ещё</span>
                    )}
                  </div>
                )}
                {result.errors.length > 0 && (
                  <ul className="import-errors">
                    {result.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="setup-field" style={{ marginTop: 22 }}>
              <label className="lbl">Цель — что хотите понимать</label>
              <GoalChips goals={STATIC_GOALS} selected={goals} onToggle={toggleGoal} />
              <div className="setup-note">Можно выбрать несколько целей — маршрут объединит их.</div>
            </div>

            <div className="setup-field">
              <label className="lbl">Интересы — что Вам интересно <span className="soft">(необязательно)</span></label>
              <GoalChips
                goals={INTERESTS.map(i => ({ id: i.id, title: i.title }))}
                selected={interests}
                onToggle={id => setInterests(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))}
              />
              <div className="setup-note">Поможем подобрать видео по вкусу — можно пропустить.</div>
            </div>

            <button
              type="button"
              className="btn btn-amber btn-lg"
              style={{ width: '100%', marginTop: 22 }}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              Построить маршрут →
            </button>
            <div className="setup-note" style={{ textAlign: 'center', marginTop: 12 }}>
              Файл обрабатывается локально в браузере. Мы берём только список слов.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
