// TryPage.tsx — /try, «Дай попробовать»: 3-шаговый визард точки А.
//
// [ID:P-abstract-goals] contract v2 2026-07-16 §1 D7/§2.2 — ПОЛНАЯ перепись
// одностраничной анкеты (было: temp/flib/fork.jsx:83-140 порт, single-select
// FilmPicker-модалка) в визард: 1) уровень+возраст → 2) цели (мультивыбор,
// свап-таб «По тайтлам»/«Групповые цели», ПРЯМОЕ добавление тапом, БЕЗ
// двухфазного «выбрать→Добавить», D7 Q3-a) → 3) интересы. На «Готово» —
// СВЕЖИЙ объект pointA (R3-инвариант, pointA.ts doc-комментарий) с
// `goalsV2`, legacy `goals`/`filmGoal` пустые/undefined.
//
// FilmPicker.tsx (модалка single-select) отсюда БОЛЬШЕ НЕ используется —
// удаляется отдельным шагом (contract §2.3, bottom-up шаг 7 плана реализации,
// FilmPicker остаётся жить до этого шага только как файл, TryPage на него не
// ссылается уже здесь). PuzzleCard (вынесен из FilmPicker, bottom-up шаг 5)
// рендерит карточки тайтлов в горизонтальном скролл-ряду «По тайтлам».
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { CEFR_LEVELS, INTERESTS, GOAL_CATEGORIES, type GoalCategory } from './data'
import { GoalChips } from './GoalChips'
import { savePointA, type GoalItemV2 } from './pointA'
import { fetchGoals, type Goal, type PuzzleItem } from './api'
import { usePuzzleCatalog } from './usePuzzleCatalog'
import { filterPuzzleItems, isHiddenPuzzleSlug, puzzleItemToTarget } from './puzzle-targets'
import { PuzzleCard } from './PuzzleCard'
import { parseVideoId } from '../lib/parse-video-id'

const SEARCH_DEBOUNCE_MS = 150
// Contract §2.2: card-cap ≤ preview rate-gate (тот же порог, что FilmPicker/
// desktop skQuick — 60 ≤ 64 обещание /api/puzzle/preview).
const CARD_CAP_QUERY = 60
const CARD_CAP_EMPTY = 20
const CUSTOM_TEXT_MAX = 280
// CUSTOM_GOAL_MAX — [ID:P-abstract-goals] Правка 4 (MED): BFF капит
// text_queries на abstractTextMaxCount=5 и молча режет лишнее (route.go
// resolveGoalV2) — юзер, добавивший 8 «Ещё»-целей, увидел бы 8 чипов, но
// маршрут учёл бы только 5 (нечестный UX, contract edge #9). Зеркалим кап на
// фронте: 6-я попытка недоступна ДО отправки, а не молча теряется на бэке.
const CUSTOM_GOAL_MAX = 5
// GOAL_PARAM_MAX_LEN — [ID:P-try-goal-param] `/try?goal=<key>`: лендинг будет
// ссылаться карточками целей сюда напрямую. Ключ — внешний вход из URL,
// обрезаем ДО любых сравнений (санитизация, не полагаемся на то, что автор
// ссылки на лендинге не налажает с длиной).
const GOAL_PARAM_MAX_LEN = 100

type WizardStep = 1 | 2 | 3
type GoalTab = 'titles' | 'groups'

interface WizardState {
  step: WizardStep
  cefr: string
  age: number
  interests: string[]
  goalsV2: GoalItemV2[]
  goalTab: GoalTab
}

function nextStepOf(s: WizardStep): WizardStep {
  return s === 1 ? 2 : 3
}
function prevStepOf(s: WizardStep): WizardStep {
  return s === 3 ? 2 : 1
}

// goalKeyOf — идентичность цели ДЛЯ ДЕДУПА (contract D7 Q3-b: "дедуп по
// slug/key/videoId") и для поиска в списке при повторном тапе/✕ на чипе.
// custom-элементы — по собственному сгенерированному id (текст сам по себе
// не годится в ключ: пользователь может добавить два похожих текста).
function goalKeyOf(g: GoalItemV2): string {
  switch (g.type) {
    case 'puzzle': return `puzzle:${g.slug}`
    case 'category': return `category:${g.key}`
    case 'youtube': return `youtube:${g.videoId}`
    case 'custom': return `custom:${g.id}`
  }
}

function chipLabelOf(g: GoalItemV2): string {
  switch (g.type) {
    case 'puzzle': return g.title
    case 'category': return g.title
    case 'youtube': return `YouTube: ${g.videoId}`
    case 'custom': return g.text
  }
}

let customGoalSeq = 0
function nextCustomGoalId(): string {
  customGoalSeq += 1
  return `custom-${Date.now()}-${customGoalSeq}`
}

// hasVisibleContent — [ID:P-abstract-goals] contract §1 D5 (Q9-2): валиден
// только текст с ≥1 unicode-буквой/цифрой после trim — режет пустышки из
// одних zero-width-символов (U+200B/U+FEFF), которые trim() НЕ удаляет
// (это не whitespace в понимании String.prototype.trim).
function hasVisibleContent(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s)
}

// ---- диалог «Свой пример (YouTube)» (contract §1 D6) ----
// Монтируется СИБЛИНГОМ .page на уровне .view (Q6-b / memory 1722) — см.
// вызов в конце файла, НЕ внутри step-контейнера (может получить transform
// на слайд-переходе шагов → фиксированный оверлей потерял бы вьюпорт).
function YoutubeGoalDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (videoId: string, url: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const id = parseVideoId(value)
    if (!id) {
      setError('Не похоже на ссылку YouTube — вставьте youtu.be/… или youtube.com/watch?v=…')
      return
    }
    onAdd(id, value.trim())
    onClose()
  }

  return (
    <div className="rs-overlay" onClick={onClose}>
      <div
        className="rs-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Свой пример: ссылка на YouTube"
        onClick={e => e.stopPropagation()}
      >
        <div className="rs-head">
          <div>
            <div className="eyebrow">Свой пример</div>
            <h2>Ссылка на YouTube</h2>
            <p>Резолвится только видео из нашей базы примеров — если его там нет, добавление не сработает.</p>
          </div>
          <button type="button" className="rs-x" onClick={onClose} aria-label="закрыть">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="rs-body">
            <input
              type="text"
              className="fp-search-input"
              value={value}
              onChange={e => { setValue(e.target.value); setError(null) }}
              placeholder="youtu.be/… или youtube.com/watch?v=…"
              autoFocus
              aria-label="Ссылка на YouTube"
            />
            {error && <div className="wizard-dialog-error">{error}</div>}
          </div>
          <div className="rs-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-amber">Добавить</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- диалог «Ещё» — свой текст цели (contract §1 D5) ----
function CustomGoalDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  const valid = hasVisibleContent(text.trim())

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    onAdd(text.trim())
    onClose()
  }

  return (
    <div className="rs-overlay" onClick={onClose}>
      <div
        className="rs-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Опишите цель своими словами"
        onClick={e => e.stopPropagation()}
      >
        <div className="rs-head">
          <div>
            <div className="eyebrow">Своими словами</div>
            <h2>Опишите цель своими словами</h2>
          </div>
          <button type="button" className="rs-x" onClick={onClose} aria-label="закрыть">✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="rs-body">
            <textarea
              className="rp-reason-textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={CUSTOM_TEXT_MAX}
              rows={4}
              autoFocus
              aria-label="Своя цель"
              placeholder="Например: хочу понимать лекции по машинному обучению"
            />
            <div className="wizard-textarea-counter">{text.length}/{CUSTOM_TEXT_MAX}</div>
          </div>
          <div className="rs-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-amber" disabled={!valid}>Добавить</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function TryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // appliedGoalParamRef — [ID:P-try-goal-param] one-shot для ?goal=: ставится
  // ТОЛЬКО в момент реального добавления (см. applyGoalFromURL-эффект ниже),
  // НЕ на монтировании — иначе шанс на резолв по catalog.items (каталог
  // грузится только с шага 2, приезжает позже goalChoices) терялся бы
  // навсегда. После добавления пользователь волен снять чип — эффект больше
  // goalsV2 не трогает.
  const appliedGoalParamRef = useRef(false)
  const [wiz, setWiz] = useState<WizardState>({
    step: 1, cefr: 'A2', age: 28, interests: [], goalsV2: [], goalTab: 'titles',
  })
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false)
  const [customDialogOpen, setCustomDialogOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  // youtubeBtnRef/customBtnRef — [ID:P-abstract-goals] Правка 7 (a11y):
  // возврат фокуса на кнопку-триггер при закрытии диалога (Tab иначе уходит
  // "под" оверлей после его размонтирования — фокус молча падает на body).
  const youtubeBtnRef = useRef<HTMLButtonElement>(null)
  const customBtnRef = useRef<HTMLButtonElement>(null)
  // goalChoices — [ID:P-abstract-goals] Правка 2 (аудит HIGH): фолбэк
  // «каталог недоступен» (Q5-b/edge #2) строится ТЕПЕРЬ ТОЛЬКО из живого
  // fetchGoals() — у него есть корректные id И `target` (STATIC_GOALS/
  // data.ts несёт ДРУГОЙ тип без target, чьи id не существуют на сервере,
  // configs/goals.json; выбор такой цели раньше давал 400 unknown_goal_id).
  // Пусто, пока запрос не резолвился ИЛИ если он тоже упал/вернул пустоту —
  // titles-таб тогда показывает честное сообщение, а не пустые/битые карточки.
  const [goalChoices, setGoalChoices] = useState<Goal[]>([])
  // goalsSettled — fetchGoals ЗАВЕРШИЛСЯ (успехом или ошибкой), в отличие от
  // «goalChoices непуст». Нужен ровно предвыбору ?goal= ниже: до ответа
  // goals.json резолвить нельзя, иначе тёплый модульный кэш каталога
  // перехватит одноимённый ключ (см. большой ⚠ у applyGoalFromURL).
  const [goalsSettled, setGoalsSettled] = useState(false)

  // usePuzzleCatalog активен с шага 2 (визард не бьёт по BFF раньше, чем
  // пользователь реально дошёл до выбора целей — тот же принцип, что
  // "FilmPicker монтируется только пока пикер открыт").
  const catalog = usePuzzleCatalog(wiz.step === 2)

  useEffect(() => {
    let cancelled = false
    fetchGoals()
      .then(list => { if (!cancelled && list.length > 0) setGoalChoices(list) })
      .catch(() => { /* сеть недоступна — goalChoices остаётся [], fallback-сообщение */ })
      // ⚠ .finally, а НЕ .then: при упавшем /api/goals предвыбор ?goal= обязан
      // разблокироваться и попробовать каталог, иначе карточка каталога
      // (zootopia-2016 и т.п.) молча не сработала бы вместе с чужим запросом.
      .finally(() => { if (!cancelled) setGoalsSettled(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const showCatalogFallback = Boolean(catalog.error) && catalog.items.length === 0
  const visiblePuzzles = useMemo(
    () => filterPuzzleItems(
      catalog.items,
      debouncedQuery,
      debouncedQuery.trim() ? CARD_CAP_QUERY : CARD_CAP_EMPTY,
    ),
    [catalog.items, debouncedQuery],
  )

  function isGoalSelected(key: string): boolean {
    return wiz.goalsV2.some(g => goalKeyOf(g) === key)
  }

  // toggleGoal — [ID:P-abstract-goals] contract §1 D7 Q3-a: ПРЯМОЕ добавление
  // тапом (без «Добавить выбранные») — тап по уже-в-списке элементу удаляет
  // его (тот же обработчик, что и добавление — единая toggle-семантика,
  // как ✕ на чипе).
  function toggleGoal(item: GoalItemV2) {
    const key = goalKeyOf(item)
    setWiz(s => (
      s.goalsV2.some(g => goalKeyOf(g) === key)
        ? { ...s, goalsV2: s.goalsV2.filter(g => goalKeyOf(g) !== key) }
        : { ...s, goalsV2: [...s.goalsV2, item] }
    ))
  }

  function removeGoal(key: string) {
    setWiz(s => ({ ...s, goalsV2: s.goalsV2.filter(g => goalKeyOf(g) !== key) }))
  }

  function togglePuzzleGoal(item: PuzzleItem) {
    const t = puzzleItemToTarget(item)
    toggleGoal({ type: 'puzzle', slug: t.slug, title: t.title, kind: t.kind, target: t.target })
  }

  function toggleCategoryGoal(cat: GoalCategory) {
    toggleGoal({ type: 'category', key: cat.key, title: cat.title })
  }

  // toggleFallbackGoal — [ID:P-abstract-goals] Правка 2: фолбэк-цель из
  // fetchGoals() кладётся в goalsV2 как ОБЫЧНЫЙ `puzzle`-элемент (решение
  // оркестратора, микро-поправка контракта) — `kind:'series'` фиксированно
  // (Goal с БФФ не несёт media_type, только `kind` — свободная строка-жанр
  // из configs/goals.json типа "Ситком"/"Криминальная драма", НЕ 'film'|
  // 'series'; фиксированный 'series' — сознательный выбор оркестратора,
  // сам `target` уже полный puzzle_ids-путь с сервера и на него не влияет).
  // Естественно уезжает в puzzle_ids на RoutePage.tsx (goalOf) — специального
  // случая/ветки для фолбэка больше нет.
  function toggleFallbackGoal(g: Goal) {
    toggleGoal({ type: 'puzzle', slug: g.id, title: g.title, kind: 'series', target: g.target })
  }

  // applyGoalFromURL — [ID:P-try-goal-param] `/try?goal=<key>` резолв в ДВА
  // захода: (а) goalChoices — id из configs/goals.json; (б) catalog.items —
  // slug каталога, точное совпадение по `slug`.
  //
  // ⚠⚠ ПОРЯДОК ЗАХОДОВ — НЕ КОСМЕТИКА, ОН ОБЯЗАН БЫТЬ ДЕТЕРМИНИРОВАННЫМ.
  // Ключи ПЕРЕСЕКАЮТСЯ, и за одним и тем же именем стоят РАЗНЫЕ сущности
  // корпуса (ПРОВЕРЕНО против боевого /api/puzzle/catalog 2026-07-17):
  //     `friends`  → goals.json: `friends-light/s01e01` (сериал, курируемый)
  //                → каталог:    slug `friends`, media_type=1 → голый `friends` (премиум = сериал, S1)
  //     `sherlock` → goals.json: `sherlock-light/s01e01`
  //                → каталог:    slug `sherlock`, media_type=1 → голый `sherlock`
  // goals.json — курируемый выбор владельца, он ВСЕГДА главнее одноимённого
  // слага каталога.
  //
  // ⚠ Поэтому ждём `goalsSettled`, а НЕ просто «goalChoices непуст»:
  // usePuzzleCatalog держит МОДУЛЬНЫЙ кэш на всю вкладку, и при повторном
  // заходе в /try catalog.items полон УЖЕ НА ПЕРВОМ РЕНДЕРЕ — раньше, чем
  // ответит fetchGoals. Без этого гейта ветка (б) перехватывала бы (а) у
  // вернувшегося пользователя, и карточка «Friends» тихо уводила бы на фильм
  // вместо сериала. Найдено адверсариальным аудитом с репро; юнит-тесты это
  // не ловили, т.к. beforeEach звал resetPuzzleCatalogCache() — тёплый кэш
  // не тестировался НИ РАЗУ (тест на него теперь есть).
  //
  // Неизвестный ключ — молча ничего: НЕ шлём id дальше в toggle/route (тот
  // самый 400 unknown_goal_id, что был багом в PR #54).
  useEffect(() => {
    if (appliedGoalParamRef.current) return
    const raw = searchParams.get('goal')
    if (!raw) return
    const key = raw.trim().slice(0, GOAL_PARAM_MAX_LEN)
    if (!key) return
    // Пока fetchGoals не отстрелялся (успехом ИЛИ ошибкой) — не резолвим
    // вообще: иначе тёплый кэш каталога выиграет гонку у goals.json.
    if (!goalsSettled) return

    // Уже выбрано вручную (гонка: юзер тапнул карточку раньше, чем
    // резолвнулся этот эффект) — не зовём toggle повторно, иначе toggle-
    // семантика (тап по уже-выбранному = снять) молча УБРАЛА бы то, что
    // юзер только что добавил сам.
    const alreadySelected = isGoalSelected(`puzzle:${key}`)

    const fromGoals = goalChoices.find(g => g.id === key)
    if (fromGoals) {
      if (!alreadySelected) toggleFallbackGoal(fromGoals)
      appliedGoalParamRef.current = true
      return
    }

    const fromCatalog = catalog.items.find(it => it.slug === key && !isHiddenPuzzleSlug(it.slug))
    if (fromCatalog) {
      if (!alreadySelected) togglePuzzleGoal(fromCatalog)
      appliedGoalParamRef.current = true
    }
  }, [searchParams, goalsSettled, goalChoices, catalog.items])

  // addYoutubeGoal/addCustomGoal — дедуп по videoId (custom — без дедупа
  // ПО СОДЕРЖИМОМУ, каждый текст самостоятелен, contract §1 D7 Q3-b дедуп
  // требует ТОЛЬКО slug/key/videoId), но addCustomGoal капается по ЧИСЛУ
  // (Правка 4/MED) — кнопка-триггер в разметке ниже уже disabled на 5-й
  // цели, это второй барьер на случай программного вызова.
  function addYoutubeGoal(videoId: string, url: string) {
    const key = `youtube:${videoId}`
    setWiz(s => (
      s.goalsV2.some(g => goalKeyOf(g) === key)
        ? s
        : { ...s, goalsV2: [...s.goalsV2, { type: 'youtube', videoId, url }] }
    ))
  }

  function addCustomGoal(text: string) {
    setWiz(s => (
      s.goalsV2.filter(g => g.type === 'custom').length >= CUSTOM_GOAL_MAX
        ? s
        : { ...s, goalsV2: [...s.goalsV2, { type: 'custom', id: nextCustomGoalId(), text }] }
    ))
  }

  // closeYoutubeDialog/closeCustomDialog — [ID:P-abstract-goals] Правка 7
  // (a11y): закрытие + возврат фокуса на кнопку-триггер синхронно (диалог
  // размонтируется этим же setState, ref ещё валиден на момент вызова).
  function closeYoutubeDialog() {
    setYoutubeDialogOpen(false)
    youtubeBtnRef.current?.focus()
  }

  function closeCustomDialog() {
    setCustomDialogOpen(false)
    customBtnRef.current?.focus()
  }

  function goBack() {
    setWiz(s => ({ ...s, step: prevStepOf(s.step) }))
  }

  function goNext() {
    setWiz(s => ({ ...s, step: nextStepOf(s.step) }))
  }

  // handleFinish — [ID:P-abstract-goals] contract §1 D2/D7 [R3]: СВЕЖИЙ
  // объект pointA, НИКОГДА {...loadPointA(), goalsV2} — см. pointA.ts
  // doc-комментарий за полным обоснованием инварианта.
  // Правка 5 (аудит MED): savePointA теперь возвращает boolean-успех — при
  // false (Safari приватный режим/забитая квота) НЕ навигируем, иначе
  // RoutePage построил бы маршрут из СТАРОГО pointA (прошлая сессия), юзер
  // молча получил бы чужую цель, пройдя весь визард.
  function handleFinish() {
    const savedAt = new Date().toISOString()
    const ok = savePointA({
      kind: 'cefr',
      level: wiz.cefr,
      ageBand: wiz.age,
      interests: wiz.interests,
      savedAt,
      goalsV2: wiz.goalsV2,
      goals: [],
      filmGoal: undefined,
    })
    if (!ok) {
      setSaveError('Не удалось сохранить — проверьте настройки приватности браузера')
      return
    }
    setSaveError(null)
    navigate('/route')
  }

  const words = CEFR_LEVELS.find(l => l.id === wiz.cefr)?.words ?? 0
  const nextDisabled = wiz.step === 2 && wiz.goalsV2.length === 0
  // customGoalCapped — [ID:P-abstract-goals] Правка 4 (MED): «Ещё» disabled
  // на 5-й custom-цели (CUSTOM_GOAL_MAX), см. addCustomGoal за вторым барьером.
  const customGoalCapped = wiz.goalsV2.filter(g => g.type === 'custom').length >= CUSTOM_GOAL_MAX

  return (
    <div className="site">
      <div className="view">
        {/* [ID:P-abstract-goals] contract §1 D7 Q6-b / memory 1722: диалоги
         *  СИБЛИНГОМ .page на уровне .view — НЕ внутри .wizard-step-scroll
         *  (может получить transform на слайд-переходе шага). */}
        {youtubeDialogOpen && (
          <YoutubeGoalDialog
            onClose={closeYoutubeDialog}
            onAdd={(videoId, url) => addYoutubeGoal(videoId, url)}
          />
        )}
        {customDialogOpen && (
          <CustomGoalDialog
            onClose={closeCustomDialog}
            onAdd={text => addCustomGoal(text)}
          />
        )}
        {/* [ID:P-abstract-goals] Правка 1 (аудит HIGH, CSS): wizard-page-frame
         *  — модификатор ТОЛЬКО этой страницы (голый .page-narrow у ImportPage/
         *  RoutePage/TestPage не трогается, см. site-theme.css). Раньше ТОЛЬКО
         *  .wizard-shell был зажат в 100dvh, но он лежал ВНУТРИ .page (padding
         *  44/32/90) ПОД topbar+fork-head (~200-230px шапки) — итоговый
         *  документ = шапка+100dvh+90px, кнопки Назад/Далее уезжали за экран,
         *  юзер скроллил ВНЕШНЮЮ страницу. Теперь ограничена ВСЯ колонка
         *  (topbar+заголовок+shell) через flex-column на height:100dvh —
         *  wizard-shell просто flex:1 1 auto внутри неё. */}
        <div className="page page-narrow wizard-page-frame">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/fork">← назад к вариантам</Link>
          </div>

          <div className="fork-head" style={{ marginBottom: 30 }}>
            <div className="eyebrow">Попробовать</div>
            <h1>Три шага — и маршрут готов</h1>
          </div>

          <div className="wizard-shell">
            {/* [ID:P-abstract-goals] Навигация ЖИВЁТ В СТРОКЕ ПРОГРЕССА, не внизу
             *  (фидбек владельца, скринкаст 2026-07-17 00-05): «кнопку далее
             *  поднимать наверх — тогда мы не ограничиваем наш список фильмов, и
             *  здесь у нас просто не будет вертикального скролла, а скролл, который
             *  появится, будет основной, на основной странице».
             *
             *  Почему это лучше прежнего низа: кнопки внизу требовали зажать
             *  колонку в height:100dvh + overflow:hidden (иначе они уезжали за
             *  край — аудит B7). Зажим душил ШАГ 2: список фильмов получал
             *  внутренний вертикальный скролл, вкладки обрезались сверху, и на
             *  экране жило ТРИ скроллбара разом («хрень» — владелец, и он прав).
             *  При этом шаги 1 и 3 влезали свободно — зажимали все три ради одного.
             *  Кнопки наверху видны ВСЕГДА без всякого зажима высоты → рамку можно
             *  отпустить, список фильмов ничем не ограничен, страница скроллится
             *  сама. Раскладка: [← Назад] ①—②—③ [Далее →] («кнопка назад как-то
             *  вот здесь между 1 и 2» — владелец). */}
            <div className="wizard-topbar">
              <div className="wizard-nav-slot wizard-nav-back">
                {wiz.step > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={goBack}>← Назад</button>
                )}
              </div>
              <div className="wizard-progress" aria-label={`Шаг ${wiz.step} из 3`}>
                <span className={`wp-dot ${wiz.step >= 1 ? 'on' : ''}`}>1</span>
                <span className="wp-line" />
                <span className={`wp-dot ${wiz.step >= 2 ? 'on' : ''}`}>2</span>
                <span className="wp-line" />
                <span className={`wp-dot ${wiz.step >= 3 ? 'on' : ''}`}>3</span>
              </div>
              <div className="wizard-nav-slot wizard-nav-next">
                {wiz.step < 3 ? (
                  <button type="button" className="btn btn-amber btn-sm" disabled={nextDisabled} onClick={goNext}>
                    Далее →
                  </button>
                ) : (
                  <button type="button" className="btn btn-amber btn-sm" onClick={handleFinish}>
                    Готово
                  </button>
                )}
              </div>
            </div>

            <div className="wizard-step-scroll">
              {wiz.step === 1 && (
                <div className="wizard-step">
                  <div className="eyebrow">Шаг 1 из 3</div>
                  <h2>Ваш уровень и возраст</h2>
                  <div className="setup-field">
                    <label className="lbl">Ваш уровень английского</label>
                    <div className="chip-row">
                      {CEFR_LEVELS.map(l => (
                        <button
                          key={l.id}
                          type="button"
                          className={`chip ${wiz.cefr === l.id ? 'on' : ''}`}
                          onClick={() => setWiz(s => ({ ...s, cefr: l.id }))}
                        >
                          {l.id}<span className="sub">{l.label.split('·')[1]?.trim()}</span>
                        </button>
                      ))}
                    </div>
                    <div className="setup-note">Возьмём стартовый словарь ≈ {words} слов под {wiz.cefr}. Тест или импорт позже уточнят.</div>
                  </div>
                  <div className="setup-field">
                    <label className="lbl">Возраст</label>
                    <div className="age-val">{wiz.age}</div>
                    <input
                      className="age-slider"
                      type="range"
                      min={8}
                      max={70}
                      value={wiz.age}
                      onChange={e => setWiz(s => ({ ...s, age: Number(e.target.value) }))}
                      aria-label="Возраст"
                    />
                    <div className="setup-note">Влияет на подбор тем и лексики маршрута.</div>
                  </div>
                </div>
              )}

              {wiz.step === 2 && (
                <div className="wizard-step">
                  <div className="eyebrow">Шаг 2 из 3</div>
                  <h2>Что хотите понимать?</h2>
                  <p className="wizard-hint">Цель — то, чему Вы научитесь, посмотрев несколько видео из нашего списка.</p>
                  {wiz.goalsV2.length >= 2 && (
                    <p className="wizard-hint">Несколько целей = один смешанный маршрут ко всем.</p>
                  )}

                  <div className="wizard-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={wiz.goalTab === 'titles'}
                      className={`wizard-tab-btn ${wiz.goalTab === 'titles' ? 'on' : ''}`}
                      onClick={() => setWiz(s => ({ ...s, goalTab: 'titles' }))}
                    >
                      По тайтлам
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={wiz.goalTab === 'groups'}
                      className={`wizard-tab-btn ${wiz.goalTab === 'groups' ? 'on' : ''}`}
                      onClick={() => setWiz(s => ({ ...s, goalTab: 'groups' }))}
                    >
                      Групповые цели
                    </button>
                  </div>

                  {wiz.goalTab === 'titles' ? (
                    <div className="wizard-titles-tab">
                      {!showCatalogFallback && (
                        <div className="fp-search-row">
                          <input
                            className="fp-search-input"
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Название на русском или английском…"
                            aria-label="Поиск фильма или сериала"
                          />
                        </div>
                      )}
                      {showCatalogFallback ? (
                        goalChoices.length > 0 ? (
                          <>
                            <div className="fp-fallback-note">
                              Каталог фильмов сейчас недоступен — выберите одну из готовых целей или попробуйте позже.
                            </div>
                            <div className="wizard-hscroll">
                              {goalChoices.map(g => {
                                const selected = isGoalSelected(`puzzle:${g.id}`)
                                return (
                                  <button
                                    key={g.id}
                                    type="button"
                                    className={'fp-card fp-card-goal' + (selected ? ' selected' : '')}
                                    onClick={() => toggleFallbackGoal(g)}
                                  >
                                    <div className="fp-card-thumb fp-card-thumb-goal" aria-hidden="true">🎬</div>
                                    <div className="fp-card-body">
                                      <div className="fp-card-title">{g.title}</div>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        ) : (
                          // [ID:P-abstract-goals] Правка 2 п.3: и /api/puzzle/catalog,
                          // И /api/goals недоступны/пусты — фолбэк-карточек показывать
                          // нечего (STATIC_GOALS больше не подстраховывает, их id не
                          // существуют на сервере), честное сообщение вместо 400.
                          <div className="fp-fallback-note">
                            Каталог сейчас недоступен — выберите групповую цель на соседней вкладке.
                          </div>
                        )
                      ) : (
                        <>
                          <div className="wizard-scroll-hint">← листайте / свайпайте →</div>
                          {catalog.loading && catalog.items.length === 0 && (
                            <div className="fp-empty">Грузим каталог…</div>
                          )}
                          <div className="wizard-hscroll">
                            {visiblePuzzles.map(item => (
                              <PuzzleCard
                                key={item.slug}
                                item={item}
                                selected={isGoalSelected(`puzzle:${item.slug}`)}
                                onClick={() => togglePuzzleGoal(item)}
                              />
                            ))}
                          </div>
                          {!catalog.loading && visiblePuzzles.length === 0 && (
                            <div className="fp-empty">Ничего не нашлось — попробуйте другой запрос.</div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="wizard-groups-tab">
                      <div className="wizard-category-grid">
                        {GOAL_CATEGORIES.map(c => (
                          <button
                            key={c.key}
                            type="button"
                            className={`chip ${isGoalSelected(`category:${c.key}`) ? 'on' : ''}`}
                            aria-pressed={isGoalSelected(`category:${c.key}`)}
                            onClick={() => toggleCategoryGoal(c)}
                          >
                            {c.title}
                          </button>
                        ))}
                      </div>
                      <div className="wizard-extra-row">
                        <button
                          ref={youtubeBtnRef}
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setYoutubeDialogOpen(true)}
                        >
                          ▶ Свой пример (YouTube)
                        </button>
                        <button
                          ref={customBtnRef}
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={customGoalCapped}
                          title={customGoalCapped ? 'максимум 5 своих целей' : undefined}
                          onClick={() => setCustomDialogOpen(true)}
                        >
                          ✎ Ещё
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="wizard-goal-chips">
                    {wiz.goalsV2.length === 0 ? (
                      <span className="fp-selected-empty">Пока ничего не выбрано</span>
                    ) : (
                      wiz.goalsV2.map(g => {
                        const key = goalKeyOf(g)
                        return (
                          <span key={key} className="fp-selchip">
                            {chipLabelOf(g)}
                            <button type="button" onClick={() => removeGoal(key)} aria-label={`убрать цель: ${chipLabelOf(g)}`}>✕</button>
                          </span>
                        )
                      })
                    )}
                  </div>
                </div>
              )}

              {wiz.step === 3 && (
                <div className="wizard-step">
                  <div className="eyebrow">Шаг 3 из 3</div>
                  <h2>Что Вам интересно?</h2>
                  <p className="wizard-hint">Поможем подобрать видео по вкусу вдобавок к цели — можно пропустить.</p>
                  <GoalChips
                    goals={INTERESTS.map(i => ({ id: i.id, title: i.title }))}
                    selected={wiz.interests}
                    onToggle={id => setWiz(s => ({
                      ...s,
                      interests: s.interests.includes(id) ? s.interests.filter(x => x !== id) : [...s.interests, id],
                    }))}
                  />
                </div>
              )}
            </div>

            {/* [ID:P-abstract-goals] Правка 5 (аудит MED): savePointA==false
             *  (Safari приватный режим/квота) — ошибка рядом с «Готово», БЕЗ
             *  навигации на /route (см. handleFinish). */}
            {saveError && <div className="wizard-dialog-error">{saveError}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
