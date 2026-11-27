// QuickStart.tsx — экран старта маршрута, путь C «Быстрый старт» (спека 2026-11-17
// §4.4, план B10a; вид — дизайн владельца 2026-11-19 §3a/§3b, cab-start.css).
//
// Шаг 1 «Уровень» — радиогруппа A1…C1 с текстами владельца (C2 в корпусе нет),
// по умолчанию — прошлый выбор из `flib:pointA`, иначе A2. Шаг 2 «Цель» —
// курируемые сериалы (`/api/goals`, общие с гостевым визардом) карточками с
// постером из НАШЕГО каталога (`/api/puzzle/preview`), темы (категории сайта),
// свёрнутое «Или добавьте своё» (ссылка YouTube и свой текст). Сборка цели —
// прежний `goalOf()`. Демо видит то же самое (решение владельца 2026-11-19 п.1).
// Каталог тайтлов (план 2026-11-19, S5): при `catalogOn(session.catalog)` (SHOW_CATALOG
// И поле catalog сессии) шаг «Цель» показывает полки «Популярное / Недавние» из
// каталога BFF вместо курируемых карточек /api/goals, а цели-тайтлы живут ТОЛЬКО в
// `goal.titles` (slug), `goal.puzzle_ids` несёт лишь youtube::<id>. Иначе (флаг 0) экран —
// ровно прежний. Тексты отказов быстрого старта — спека §7.3, Р-В14 (start-model.ts).
//
// Ответы BFF (поведение прежнее):
//   202 {job_id, revision} — опрос (страница показывает «Подбираем ролики»);
//   409 route_exists — начат на другом устройстве: перечитать;
//   409 profile_has_words — вопрос «Оставить мой список / Заменить» (модальное
//     окно) и повтор с known_words (и шаг 2, и гонка C2 — одно и то же, §4.4);
//   400 goal_empty / goal_not_resolved — тексты; временный сбой — отсчёт, затем
//     перечитать состояние (повтор безопасен: шаг 1 различает состояния).
// Ошибки — красной плашкой в нижней полосе вместо сводки (дизайн §3b п.4).
//
// Маршрута без цели нет (решение владельца 2026-11-19). «Начать маршрут» активна
// всегда, но без цели запроса нет: страница прокручивается к шагу 2 и просит
// «Выберите хотя бы одну цель» (подсказка, не ошибка).
// Сохранённая цель-фильм/сериал (flib:pointA), которой нет среди карточек /api/goals
// (гость выбрал её в широком каталоге, или ответа /api/goals ещё/уже нет), показывается
// чипом с × под карточками, считается и уходит в цель (ревью v2a R1-M2). Выбрасывается
// только цель без target — её нечем показать. Старые id целей BFF подменяет сам
// (target_aliases в configs/goals.json).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { GOAL_CATEGORIES } from '../../data'
import { fetchGoals, type Goal } from '../../api'
import { loadPointA, type GoalItemV2, type TitleRef } from '../../pointA'
import { migratePointATitles } from '../../pointA-titles'
import { loadRecentTitles, pushRecentTitle } from '../../recent-titles'
import { useSession } from '../../useSession'
import { goalOf } from '../../route-goal'
import { parseVideoId } from '../../../lib/parse-video-id'
import { CabI } from '../cab-icons'
import { useVideoTitles } from './use-video-titles'
import { routeApi, retryDelaySec, createGoal, type ApiError, type GoalView } from './route-api'
import { clearGoalDraft, draftFor, loadGoalDraft, saveGoalDraft } from './route-storage'
import {
  GoalHarvestPanel, harvestUsable, COPY_DEMO, COPY_EMPTY, COPY_TITLE_LOADING, type GoalFailure,
} from './GoalHarvestPanel'
import { resetHeardCheckMemory } from './heard-check/heard-check-memory'
import { forDate, savedDayTransition, saveDayTransition } from './learning-day'
import { loadSettings, saveSettings, settingsBody, type RouteSettings } from './route-settings'
import { RouteStartSettings } from './RouteStartSettings'
import { SupportLink, useCountdown } from './RouteMessages'
import { GoalPoster } from './GoalPoster'
import { checkTitles, type TitleCard } from '../catalog/catalog-api'
import { displayTitle, TitleShelves, useTitleShelves, type ShelfId } from './TitleShelves'
import { CatalogInline } from '../catalog/CatalogInline'
import type { CatalogView } from '../catalog/use-catalog-list'
import { TitleDetail } from '../catalog/TitleDetail'
import { TopicIcon } from './topic-icons'
import {
  catalogOn, CATALOG_UNAVAILABLE_TEXT, toggleTitleRef, DEFAULT_LEVEL, imdbUrl, isStartLevel, levelSummary, NEED_GOAL_PROMPT, quickStartErrorText,
  SHOW_CATALOG, START_LEVELS, whyTexts, ytThumb,
  type StartLevel,
} from './start-model'
import { usePlacement, invalidatePlacement } from '../placement/use-placement'
import { openSiteHost, type SiteHost } from '../placement/site-host'
import { applyPlacement } from '../placement/apply'
import { PlacementLink } from '../PlacementLink'
import { approxWords, placementGate, requestLevel, ruDate, ruInt, usableResult } from '../placement-entry'
import './route-start.css'

const APPLY_FAILED_TEXT = 'Не удалось передать слова теста маршруту. Попробуйте ещё раз или укажите уровень самому'

const CUSTOM_MAX = 5
const CUSTOM_MAX_LEN = 280

const goalKey = (g: GoalItemV2): string =>
  g.type === 'puzzle' ? `puzzle:${g.slug}` : g.type === 'category' ? `category:${g.key}` : g.type === 'youtube' ? `youtube:${g.videoId}` : `custom:${g.id}`

const goalTitle = (g: GoalItemV2): string =>
  g.type === 'puzzle' || g.type === 'category' ? g.title : g.type === 'youtube' ? `YouTube: ${g.videoId}` : g.text

let customSeq = 0

export interface QuickStartProps {
  /** Плитка «Все фильмы и сериалы →» (панель каталога — S6). */
  onOpenCatalog?: () => void
  onStarted: (jobId: string, revision: number) => void
  onReread: () => void
  onPageError: (status: number, code: string) => void
}

const GOAL_LABEL_MAX_RUNES = 120
const MAX_TITLES = 10 // потолок тайтлов в цели (PD-4)
const MAX_VIDEOS = 50 // ролики пользователя в сборе «Моих целей»
const MAX_GOAL_ITEMS = 20 // titles + ролики в puzzle_ids (BFF quickStartMaxGoals)
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`

// Метка цели с названиями тайтлов (русские — как у остальных частей цели): BFF
// собирает свою только когда клиентская пуста, поэтому названия тайтлов кладём сюда.
function labelWithTitles(titles: TitleRef[], rest: string | undefined): string {
  const parts = [...titles.map(t => t.title || t.slug), ...(rest ? [rest] : [])]
  return Array.from(parts.join(' + ')).slice(0, GOAL_LABEL_MAX_RUNES).join('')
}

export function QuickStart({ onOpenCatalog, onStarted, onReread, onPageError }: QuickStartProps) {
  const session = useSession()
  const catalog = catalogOn(session.catalog, SHOW_CATALOG)
  const initial = useMemo(() => {
    const p = loadPointA()
    const level: StartLevel = p && p.kind === 'cefr' && isStartLevel(p.level) ? p.level : DEFAULT_LEVEL
    const base = p && p.kind === 'cefr' && Array.isArray(p.goalsV2) ? p.goalsV2 : []
    // «Мои цели»: черновик с запросом этого ключа — ролики возвращаются в цель, панель сразу в ожидании.
    const draft = session.demo ? null : loadGoalDraft(session.keyPrefix)
    const restored = draft?.request_id ? draft : null
    const goals = restored
      ? [...base, ...restored.video_ids.filter(id => !base.some(g => g.type === 'youtube' && g.videoId === id)).map(id => ({ type: 'youtube' as const, videoId: id, url: `https://youtu.be/${id}` }))]
      : base
    return { level, goals, restored }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [level, setLevelState] = useState<StartLevel>(initial.level)
  // Тест уровня (спека §4 «Входы»): годный результат подменяет шаг «Уровень»; любой сбой сводки — как будто теста нет.
  const pl = usePlacement(placementGate(session))
  const usable = usableResult(pl.summary)
  const [ownLevel, setOwnLevel] = useState(false)
  const useResult = usable !== null && !ownLevel
  const levelTouched = useRef(false)
  const setLevel = (l: StartLevel) => { levelTouched.current = true; setLevelState(l) }
  // Результат-«пол» (пустой, A1): обычный выбор, A1 предвыбран, пока человек сам не выбрал.
  const floorLast = pl.summary?.last
  const floor = !!floorLast && floorLast.floor === true
  useEffect(() => { if (floor && !levelTouched.current && !ask && !sending) setLevelState('A1') }, [floor]) // eslint-disable-line react-hooks/exhaustive-deps
  // Уровень, по которому идут цель, подсказки и запрос: результат теста (B1+ → B1) или выбранный.
  const effLevel: StartLevel = useResult ? requestLevel(usable!.level) : level
  const applying = useRef(false)
  const [goals, setGoals] = useState<GoalItemV2[]>(initial.goals)
  // «Настройки маршрута»: значения прошлого раза этого браузера (сервер после старта главнее).
  const [rs, setRs] = useState<RouteSettings>(() => loadSettings())
  const [dayMin, setDayMin] = useState<number>(() => savedDayTransition())
  const changeSettings = (next: RouteSettings) => { setRs(next); saveSettings(next) }
  const changeDayMin = (m: number) => { setDayMin(m); saveDayTransition(m) }
  const [curated, setCurated] = useState<Goal[]>([])
  const [yt, setYt] = useState('')
  const [ytBad, setYtBad] = useState(false)
  const [ytMsg, setYtMsg] = useState<string | null>(null)
  // «Мои цели»: запрос сбора (id шлюза + ответ создания), идущее создание, ошибка создания.
  const paid = !session.demo
  const [req, setReq] = useState<{ id: string; ids: string; initial: GoalView | null } | null>(
    () => (initial.restored?.request_id ? { id: initial.restored.request_id, ids: [...initial.restored.video_ids].sort().join(','), initial: null } : null))
  const [view, setView] = useState<GoalView | null>(null)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<GoalFailure | null>(null)
  const [srcEmpty, setSrcEmpty] = useState(false)
  const withSource = useRef(false)
  const prevKey = useRef('')
  const [custom, setCustom] = useState('')
  const [sending, setSending] = useState(false)
  const [ask, setAsk] = useState(false)
  // Сводка пришла, когда человек уже выбрал уровень сам или открыт вопрос «Оставить / Заменить»: остаёмся в его выборе
  // (со ссылкой «Вернуться к результату теста»), результат не перехватывает экран.
  const usableRun = usable?.run_id ?? ''
  useLayoutEffect(() => { if (usableRun !== '' && (levelTouched.current || ask)) setOwnLevel(true) }, [usableRun]) // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null)
  // down — ожидание Retry-After: отсчёт (бан — «продолжим в HH:MM»), кнопка
  // неактивна до его конца (ревью 3а, L3), затем — перечитать состояние.
  const [down, setDown] = useState<{ until: number; banned: boolean; catalog?: boolean } | null>(null)
  const [refused, setRefused] = useState(false)
  // need — нажали «Начать маршрут» без цели: подсказка у шага 2.
  const [need, setNeed] = useState(false)
  // Каталог: выбранные тайтлы (только slug уходит в цель), полка, «Недавние» этого устройства.
  const [titles, setTitles] = useState<TitleRef[]>([])
  const [shelf, setShelf] = useState<ShelfId>('popular')
  const [recentSlugs, setRecentSlugs] = useState<string[]>(() => loadRecentTitles())
  const [hasRecent, setHasRecent] = useState(() => recentSlugs.length > 0)
  // Полный каталог — внутри шага «Цель» (вместо полок); подробная карточка — слой поверх экрана. Выбор живёт здесь.
  const [catalogOpen, setCatalogOpen] = useState(false)
  // Фильтры/поиск каталога живут здесь, чтобы пережить сворачивание (L5).
  const catalogView = useRef<CatalogView | undefined>(undefined)
  const [detail, setDetail] = useState<{ card: TitleCard; snapshot?: string } | null>(null)
  const shelves = useTitleShelves(catalog, shelf, recentSlugs)
  const goalSec = useRef<HTMLElement>(null)
  const goBtn = useRef<HTMLButtonElement>(null)
  const dlgPrimary = useRef<HTMLButtonElement>(null)
  const catTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (catTimer.current) clearTimeout(catTimer.current) }, [])
  // «Недавние» опустели (все ушли из снимка): переключателя нет, полка — «Популярное».
  useEffect(() => {
    if (shelf === 'recent' && shelves.recent.status === 'ready' && shelves.recent.items.length === 0) { setHasRecent(false); setShelf('popular') }
  }, [shelf, shelves.recent])

  useEffect(() => {
    if (catalog) return // каталог включён: курируемые карточки и /api/goals не читаются
    let alive = true
    fetchGoals().then(g => { if (alive) setCurated(g) }).catch(() => { /* без курируемых целей — темы, ссылка, текст */ })
    return () => { alive = false }
  }, [catalog])

  // Предвыбор тайтлов из flib:pointA (спека §7.4): при каждом открытии, проверка по снимку.
  useEffect(() => {
    if (!catalog) return
    let alive = true
    void migratePointATitles(slugs => checkTitles(slugs)).then(ts => {
      if (!alive || ts.length === 0) return
      setTitles(cur => [...cur, ...ts.filter(t => !cur.some(c => c.slug === t.slug))].slice(0, MAX_TITLES))
    })
    return () => { alive = false }
  }, [catalog])

  const keys = goals.map(goalKey)
  const toggle = (g: GoalItemV2) => {
    const k = goalKey(g)
    setGoals(gs => (gs.some(x => goalKey(x) === k) ? gs.filter(x => goalKey(x) !== k) : [...gs, g]))
    setNeed(false)
  }
  const toggleTitle = (c: TitleCard) => {
    // Потолок проверяется ДО setTitles (в чистой toggleTitleRef): 11-й не принимается и при прямом вызове.
    const next = toggleTitleRef(titles, { slug: c.slug, title: displayTitle(c) }, MAX_TITLES)
    setTitles(next)
    if (next.length > titles.length) { pushRecentTitle(c.slug); setHasRecent(true) }
    setNeed(false)
  }
  // Открытая карточка попадает в «Недавние» этого устройства (спека §7.5).
  const openDetail = (card: TitleCard, snapshot?: string) => {
    pushRecentTitle(card.slug)
    setHasRecent(true)
    setDetail({ card, snapshot })
  }
  // Свернуть каталог обратно в полки: выбор остаётся; если верх шага выше экрана — вернуть его в вид.
  const collapseCatalog = () => {
    setCatalogOpen(false)
    const el = goalSec.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: 'start' })
  }
  const removeTitle = (slug: string) => setTitles(ts => ts.filter(x => x.slug !== slug))
  // Фокус не теряется при смене вида (M2): раскрыли — в поле поиска, свернули — на плитку «Все тайтлы»
  // (плитка появляется, когда полка готова, поэтому ждём её, пока цель не найдена).
  const focusPending = useRef(false)
  const prevOpen = useRef(false)
  useEffect(() => {
    if (prevOpen.current !== catalogOpen) { prevOpen.current = catalogOpen; focusPending.current = true }
    if (!focusPending.current) return
    const root = goalSec.current
    const target = catalogOpen ? (window.matchMedia?.('(pointer: fine)').matches ? root?.querySelector<HTMLElement>('.ct-q input') : root?.querySelector<HTMLElement>('.ct .sh-h h3')) : root?.querySelector<HTMLElement>('.gc-all')
    if (target) { focusPending.current = false; target.focus({ preventScroll: true }) }
  }, [catalogOpen, shelves.popular.status])
  const switchShelf = (s: ShelfId) => {
    if (s === 'recent') setRecentSlugs(loadRecentTitles())
    setShelf(s)
  }
  const addYt = () => {
    const ids = yt.split(/\s+/).map(parseVideoId).filter((x): x is string => !!x)
    if (ids.length === 0) { setYtBad(true); setYtMsg(null); return }
    setYtBad(false)
    setYt('')
    const have = goals.filter(g => g.type === 'youtube').length
    const fresh = Array.from(new Set(ids)).filter(id => !keys.includes(`youtube:${id}`))
    const room = paid ? Math.max(0, MAX_VIDEOS - have) : fresh.length
    const take = fresh.slice(0, room)
    setYtMsg(fresh.length > take.length ? `Можно добавить не больше ${MAX_VIDEOS} роликов.` : null)
    if (take.length === 0) return
    setGoals(gs => [...gs, ...take.map(id => ({ type: 'youtube' as const, videoId: id, url: watchUrl(id) }))])
    setNeed(false)
  }
  const customCount = goals.filter(g => g.type === 'custom').length
  const addCustom = () => {
    const t = custom.trim().slice(0, CUSTOM_MAX_LEN)
    if (!t || customCount >= CUSTOM_MAX) return
    setCustom('')
    customSeq += 1
    toggle({ type: 'custom', id: `custom-${Date.now()}-${customSeq}`, text: t })
  }
  const onEnter = (fn: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); fn() }
  }

  // Сериал, выбранный раньше (flib:pointA), несёт сохранённый тогда target; берём
  // текущий из /api/goals: старый мог не существовать в индексе демона (ted-lasso/s01e01
  // вместо ted-lasso-2020/s01e01 — один неизвестный id роняет весь маршрут).
  // Цель без target не считается и не уходит; у курируемой — текущий target из /api/goals.
  const effective = goals.flatMap<GoalItemV2>(g => {
    // Каталог включён: тайтлы живут только в titles, puzzle-цели в тело не идут.
    if (catalog && g.type === 'puzzle') return []
    if (g.type !== 'puzzle') return [g]
    const c = curated.find(x => x.id === g.slug)
    if (!c) return g.target ? [g] : []
    return [c.target !== g.target ? { ...g, target: c.target } : g]
  })
  // extra — цели-фильмы/сериалы, которых нет среди карточек: чипы с ×.
  const extra = effective.filter((g): g is Extract<GoalItemV2, { type: 'puzzle' }> => g.type === 'puzzle' && !curated.some(c => c.id === g.slug))
  const baseGoal = goalOf({ kind: 'cefr', level: effLevel, ageBand: 0, goals: [], goalsV2: effective, savedAt: '' }).goal
  const goal = catalog && titles.length > 0
    ? { ...(baseGoal ?? {}), titles: titles.map(t => t.slug), label: labelWithTitles(titles, baseGoal?.label) }
    : baseGoal
  const selectedCount = effective.length + (catalog ? titles.length : 0)
  const selectedSlugs = useMemo(() => new Set(titles.map(t => t.slug)), [titles])
  // Выбранный тайтл вне показанной полки — чип с × (считается и снимается).
  // «Вне обеих полок»: пока «Популярное» грузится, чипов нет (иначе все выбранные мигнут чипами).
  const onShelfSlugs = new Set([...shelves.popular.items, ...shelves.recent.items].map(i => i.slug))
  const extraTitles = shelves.popular.status === 'loading' ? [] : titles.filter(t => !onShelfSlugs.has(t.slug))
  const own = goals.filter(g => g.type === 'youtube' || g.type === 'custom')
  const videoIds = goals.flatMap(g => (g.type === 'youtube' ? [g.videoId] : []))
  const videoKey = [...videoIds].sort().join(',')
  // Названия своих роликов (узнаёт BFF); у демо своих роликов нет — запросов нет.
  const vt = useVideoTitles(videoIds, !session.demo)
  // puzzle_ids: ролики идут как раньше, но не больше 20 вместе с тайтлами (иначе BFF отказывает).
  const ytCap = Math.max(0, MAX_GOAL_ITEMS - (catalog ? titles.length : 0) - effective.filter(g => g.type === 'puzzle').length)
  const ytKeep = new Set(videoIds.slice(0, ytCap))
  const trimmedGoal = goal?.puzzle_ids
    ? { ...goal, puzzle_ids: goal.puzzle_ids.filter(id => !id.startsWith('youtube::') || ytKeep.has(id.slice('youtube::'.length))) }
    : goal
  const keyRef = useRef('')
  keyRef.current = videoKey
  const harvestOn = paid && req !== null && req.ids === videoKey
  const harvestOk = harvestOn && harvestUsable(view ?? req!.initial) && !srcEmpty
  const harvestBusy = paid && videoIds.length > 0 && (creating || (harvestOn && !harvestOk))
  const harvestShown = paid && (creating || createErr !== null || harvestOn)

  // Набор ссылок изменился — запрос и ошибка прежнего набора не действуют.
  useEffect(() => {
    if (req && req.ids !== videoKey) { setReq(null); setView(null) }
    setSrcEmpty(false)
    setCreateErr(null)
    if (videoIds.length === 0 && prevKey.current !== '') clearGoalDraft(session.keyPrefix)
    prevKey.current = videoKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKey])

  async function startHarvest() {
    if (creating || videoIds.length === 0) return
    const d = draftFor(session.keyPrefix, videoIds)
    saveGoalDraft(session.keyPrefix, d)
    const ids = [...videoIds].sort().join(',')
    if (d.request_id) { setReq({ id: d.request_id, ids, initial: null }); return }
    setSrcEmpty(false)
    setCreating(true); setCreateErr(null)
    const r = await createGoal({ video_urls: videoIds.map(watchUrl), client_request_id: d.client_request_id })
    setCreating(false)
    if (keyRef.current !== ids) return // ссылки изменили, пока шло создание: ответ устарел
    if (!r.ok) { setCreateErr(r); return }
    saveGoalDraft(session.keyPrefix, { ...d, request_id: r.goal.request_id })
    setView(r.goal)
    setReq({ id: r.goal.request_id, ids, initial: r.goal })
  }

  // Применить слова текущего результата к профилю (force). Хост — без замка вкладки теста: apply сессию не пишет.
  async function applyTestWords(): Promise<boolean> {
    let host: SiteHost | null = null
    try {
      host = await openSiteHost({ locks: null })
      const o = await applyPlacement(host, { force: true })
      if (o.kind !== 'done') return false
      return true
    } catch {
      return false
    } finally {
      host?.dispose()
    }
  }

  async function send(knownWords?: 'keep' | 'replace', source?: boolean) {
    if (sending || down || applying.current) return
    if (source !== undefined) withSource.current = source
    if (!goal) { askForGoal(); return }
    applying.current = true
    setSending(true); setErr(null); setDown(null); setRefused(false)
    const useSource = withSource.current && harvestOn && !!req
    const sentGoal = useSource ? { ...trimmedGoal, source_request_id: req!.id } : trimmedGoal
    const body: Record<string, unknown> = { cefr_level: effLevel, goal: sentGoal, for_date: forDate(null, new Date(), dayMin), ...settingsBody(rs) }
    // Явный выбор «Оставить»/«Заменить» сильнее результата теста.
    const asIs = useResult && !knownWords
    body.cefr_level = asIs ? effLevel : level
    if (asIs) body.known_words = 'as_is'
    else if (knownWords) body.known_words = knownWords
    let r: Awaited<ReturnType<typeof routeApi.quickStart>>
    try {
      // Слова теста ещё не в профиле (или человек раньше начинал со своим уровнем): передать их ДО старта.
      if (asIs && (!pl.summary?.applied || pl.summary.declined) && !(await applyTestWords())) {
        setSending(false); setErr(APPLY_FAILED_TEXT); return
      }
      r = await routeApi.quickStart(body)
      // Профиль потерял слова теста между сводкой и стартом: применить принудительно и повторить один раз.
      if (!r.ok && asIs && r.status === 409 && r.code === 'placement_not_applied') {
        if (!(await applyTestWords())) { setSending(false); setErr(APPLY_FAILED_TEXT); return }
        r = await routeApi.quickStart(body)
        if (!r.ok && r.status === 409 && r.code === 'placement_not_applied') { setSending(false); setErr(APPLY_FAILED_TEXT); return }
      }
    } finally {
      applying.current = false
      // Сводка теста могла измениться (declined после «Заменить», applied после apply): перечитать.
      if (placementGate(session)) invalidatePlacement()
    }
    setSending(false)
    // Вопрос «Оставить / Заменить» — экран остаётся в выборе человека, даже если результат теста пришёл позже запроса.
    if (!r.ok && r.status === 409 && r.code === 'profile_has_words' && !asIs) setOwnLevel(true)
    if (r.ok) { resetHeardCheckMemory(); setAsk(false); if (videoIds.length > 0) clearGoalDraft(session.keyPrefix); onStarted(r.data.job_id, r.data.revision ?? 0); return }
    // Ответ на «Оставить / Заменить», кроме повторного вопроса, закрывает окно:
    // ошибка видна плашкой в полосе, а не под затемнением.
    if (!(r.status === 409 && r.code === 'profile_has_words')) closeAsk()
    handleError(r)
  }

  function askForGoal() {
    setErr(null); setRefused(false); setNeed(true)
    try { goalSec.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* окружение без прокрутки */ }
    // Фокус — на шаг «Цель» (спека §7.5): подсказка role=alert читается с него.
    try { goalSec.current?.focus({ preventScroll: true }) } catch { /* окружение без фокуса */ }
  }

  function closeAsk() {
    setAsk(false)
    // Фокус возвращается туда, откуда открыли окно.
    setTimeout(() => { goBtn.current?.focus() }, 0)
  }

  // Окно вопроса: фокус — в окно (основная кнопка), Esc закрывает.
  useEffect(() => {
    if (!ask) return
    dlgPrimary.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { setAsk(false); goBtn.current?.focus() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask])

  function handleError(r: ApiError) {
    if (r.status === 409 && r.code === 'profile_has_words') { setAsk(true); return }
    if (r.status === 409 && r.code === 'route_exists') { onReread(); return }
    if (r.status === 409 && r.code === 'goal_not_ready') { setErr('Сбор слов ещё не завершён. Подождите немного'); return }
    if (r.status === 409 && r.code === 'goal_empty') { setSrcEmpty(true); setErr(COPY_EMPTY); return }
    if (r.status === 400 && r.code === 'goal_source_unknown') {
      setReq(null); setView(null); clearGoalDraft(session.keyPrefix)
      setErr('Сбор слов не найден. Начните без сбора слов или добавьте ролики заново')
      return
    }
    if (r.status === 400 && r.code === 'goal_not_resolved') { setErr('Для этой цели пока нет материала — добавьте фильм, ролик или свои слова'); return }
    if (r.status === 400 && r.code === 'goal_empty') { askForGoal(); return }
    // Отказы цели-тайтла (спека §7.3): unknown/unavailable называют slug — снимается ровно этот
    // чип, остальные цели нетронуты; тексты утверждены (Р-В14).
    if (r.status === 400 && (r.code === 'goal_title_unknown' || r.code === 'goal_title_unavailable')) {
      const slug = typeof r.body?.slug === 'string' ? r.body.slug : null
      if (slug) setTitles(ts => ts.filter(t => t.slug !== slug))
      setErr(quickStartErrorText(r.code, r.body))
      return
    }
    if (r.status === 400 && (r.code === 'too_many_goals' || r.code === 'goal_target_invalid')) {
      setErr(quickStartErrorText(r.code, r.body))
      return
    }
    // Нет снимка каталога / флаг выключен: повтор не раньше Retry-After (кнопка неактивна), без
    // перечитывания состояния — маршрут тут ни при чём.
    if (r.status === 503 && r.code === 'catalog_unavailable') {
      const ms = retryDelaySec(r) * 1000
      setErr(CATALOG_UNAVAILABLE_TEXT)
      setDown({ until: Date.now() + ms, banned: false, catalog: true })
      if (catTimer.current) clearTimeout(catTimer.current)
      catTimer.current = setTimeout(() => { setDown(null) }, ms)
      return
    }
    if (r.status === 403 || r.status === 401) { onPageError(r.status, r.code ?? 'forbidden'); return }
    if (r.cls === 'refused') { setRefused(true); return }
    if (r.cls === 'temporary' || r.cls === 'rate') {
      const ms = retryDelaySec(r) * 1000
      setDown({ until: Date.now() + ms, banned: r.code === 'route_banned' })
      setTimeout(() => { setDown(null); onReread() }, ms)
      return
    }
    setErr('Не удалось начать маршрут. Попробуйте ещё раз')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (paid && videoIds.length > 0) {
      if (harvestOk) void send(undefined, true)
      else if (!harvestBusy) void startHarvest()
      return
    }
    void send(undefined, false)
  }
  const failed = !!err || !!down || refused

  return (
    <div className="st">
      <div className="ph">
        <span className="mono">Маршрут</span>
        <h1>Давайте установим <em>Ваш реальный уровень</em></h1>
      </div>
      <div className="st-way">
        <span className="st-way-tag"><CabI.play />Быстрый старт</span>
        <p className="st-way-txt">Укажите свой уровень владения языком и выберите материал, который хотите понимать на слух. Мы начнём с рекомендаций видео для просмотров от Вашего уровня и будем двигаться к Вашей цели, наблюдая за Вашими успехами.</p>
        {pl.summary && usable === null && (
          <span className="st-soon pt-offer" data-testid="st-placement-offer">
            Не знаете свой уровень? Пройдите тест — около 5 минут.{' '}
            <PlacementLink className="btn sm">{pl.unfinished ? 'Продолжить тест' : 'Пройти тест'}</PlacementLink>
          </span>
        )}
      </div>
      <form onSubmit={onSubmit}>
        <section className="st-sec">
          <div className="st-h"><span className="st-n">1</span><h2 id="st-level">Уровень</h2></div>
          {useResult && usable && (
            <div className="pt-res" data-testid="st-placement-result">
              <div className="lv-c on pt-res-c" aria-current="true">
                <span className="lv-name">Результат теста</span>
                <span className="pt-res-t">По тесту от {ruDate(usable.taken_at)}: {usable.level}, примерно {ruInt(approxWords(usable))} слов</span>
                <span className="lv-ck"><CabI.check /></span>
              </div>
              <div className="pt-res-links">
                <button type="button" className="pt-link" onClick={() => setOwnLevel(true)}>Указать уровень самому</button>
                <PlacementLink className="pt-link">Пройти заново</PlacementLink>
              </div>
            </div>
          )}
          {usable && ownLevel && !ask && (
            <p className="pt-back"><button type="button" className="pt-link" onClick={() => setOwnLevel(false)}>Вернуться к результату теста</button></p>
          )}
          {!useResult && <div className="lv" role="radiogroup" aria-labelledby="st-level">
            {START_LEVELS.map(l => {
              const on = level === l.id
              return (
                <button key={l.id} type="button" role="radio" aria-checked={on} className={'lv-c' + (on ? ' on' : '')} onClick={() => setLevel(l.id)}>
                  <span className="lv-code">{l.id}</span>
                  <span className="lv-name">{l.name}</span>
                  <span className="lv-d">{l.text}</span>
                  {on && <span className="lv-ck"><CabI.check /></span>}
                </button>
              )
            })}
          </div>}
        </section>

        <section className="st-sec" id="st-goal" ref={goalSec} tabIndex={-1}>
          <div className="st-h"><span className="st-n">2</span><h2>Цель</h2></div>
          {need && selectedCount === 0 && <p className="st-need-msg" role="alert">{NEED_GOAL_PROMPT}</p>}
          {whyTexts(effLevel).map((t, i) => <p key={i} className={'st-why' + (i > 0 ? ' st-why2' : '')}>{t}</p>)}

          {catalog && (
            <>
              {catalogOpen ? (
                <CatalogInline selected={selectedSlugs} capped={titles.length >= MAX_TITLES}
                  onToggle={toggleTitle} onDetail={openDetail} onCollapse={collapseCatalog}
                  chosen={titles} onRemove={removeTitle} saved={catalogView.current} onViewChange={v => { catalogView.current = v }} />
              ) : (
                <TitleShelves shelf={shelf} onShelf={switchShelf} hasRecent={hasRecent} data={shelves} selected={selectedSlugs} capped={titles.length >= MAX_TITLES}
                  onToggle={toggleTitle} onOpenCatalog={() => { setCatalogOpen(true); onOpenCatalog?.() }} onDetail={openDetail} />
              )}
              {!catalogOpen && extraTitles.length > 0 && (
                <div className="gc-extra">
                  {extraTitles.map(t => (
                    <span key={t.slug} className="chip on">
                      {t.title || t.slug}
                      <button type="button" className="x" aria-label={`Убрать цель ${t.title || t.slug}`}
                        onClick={() => removeTitle(t.slug)}><CabI.x /></button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {!catalog && curated.length > 0 && (
            <>
              <div className="sh-h"><h3>Фильмы и сериалы</h3></div>
              <div className="gc-grid">
                {curated.map((g, i) => {
                  const on = keys.includes(`puzzle:${g.id}`)
                  return <GoalCard key={g.id} goal={g} hue={(i * 47 + 30) % 360} on={on}
                    onToggle={() => toggle({ type: 'puzzle', slug: g.id, title: g.title, kind: 'series', target: g.target })} />
                })}
              </div>
            </>
          )}

          {!catalog && extra.length > 0 && (
            <>
              {curated.length === 0 && <div className="sh-h"><h3>Фильмы и сериалы</h3></div>}
              <div className="gc-extra">
                {extra.map(g => (
                  <span key={goalKey(g)} className="chip on">
                    {g.title || g.target}
                    <button type="button" className="x" aria-label={`Убрать цель ${g.title || g.target}`} onClick={() => toggle(g)}><CabI.x /></button>
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="sh-h" style={{ marginTop: 36 }}><h3>Темы</h3></div>
          <div className="tp-wrap">
            {GOAL_CATEGORIES.map(c => {
              const on = keys.includes(`category:${c.key}`)
              return (
                <button key={c.key} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on}
                  onClick={() => toggle({ type: 'category', key: c.key, title: c.title })}>
                  <TopicIcon k={c.key} />{c.title}
                </button>
              )
            })}
          </div>

          <details className="own2">
            <summary><CabI.chev />Или добавьте своё{own.length > 0 && <span className="tag acc">{own.length}</span>}</summary>
            <div className="own2-b">
              {paid ? (
                <div className="field">
                  <span className="mono">Ссылка на ролик YouTube</span>
                  <span className="own-row">
                    <span className={'inp' + (ytBad ? ' bad' : '')}>
                      <input aria-label="Ссылка на ролик YouTube" placeholder="https://www.youtube.com/watch?v=…" value={yt}
                        onChange={e => { setYt(e.target.value); setYtBad(false); setYtMsg(null) }} onKeyDown={onEnter(addYt)} />
                    </span>
                    <button type="button" className="btn" disabled={!yt.trim()} onClick={addYt}>Добавить ролик</button>
                  </span>
                  {ytMsg && <span className="mute">{ytMsg}</span>}
                </div>
              ) : (
                <div className="field own-demo">
                  <span>{COPY_DEMO}. <a href="/buy">Подробнее</a></span>
                </div>
              )}
              <div className="field">
                <span className="mono">Слова, которые хотите, чтобы постепенно добавлялись в ролики</span>
                <span className="own-row">
                  <span className="inp">
                    <input aria-label="Слова, которые хотите, чтобы постепенно добавлялись в ролики" maxLength={CUSTOM_MAX_LEN} value={custom}
                      onChange={e => setCustom(e.target.value)} onKeyDown={onEnter(addCustom)} />
                  </span>
                  <button type="button" className="btn" disabled={!custom.trim() || customCount >= CUSTOM_MAX} onClick={addCustom}>Добавить текст</button>
                </span>
              </div>
              <div className="own-file" aria-disabled="true">
                <CabI.upload />
                <div className="own-file-b">
                  <div className="own-file-t">Видео и аудио с компьютера <span className="tag acc">Скоро</span></div>
                  <span className="mute">Один или несколько файлов, не более 300 Мб</span>
                </div>
                <button type="button" className="btn" disabled>Выбрать файлы</button>
              </div>
              {own.length > 0 && (
                <div className="own-items">
                  {own.map(g => g.type === 'youtube' ? (
                    <div key={goalKey(g)} className="yt-card">
                      <YtThumb videoId={g.videoId} />
                      <span className="yt-t" title={vt.titleOf(g.videoId) ?? undefined}>
                        {vt.titleOf(g.videoId) ?? (vt.loading(g.videoId) ? COPY_TITLE_LOADING : goalTitle(g))}
                      </span>
                      <button type="button" className="x" aria-label={`Убрать цель ${vt.titleOf(g.videoId) ?? goalTitle(g)}`} onClick={() => toggle(g)}><CabI.x /></button>
                    </div>
                  ) : (
                    <span key={goalKey(g)} className="chip sm on">
                      {goalTitle(g)}
                      <button type="button" className="x" aria-label={`Убрать цель ${goalTitle(g)}`} onClick={() => toggle(g)}><CabI.x /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </details>
          {harvestShown && (
            <GoalHarvestPanel
              requestId={harvestOn ? req!.id : null} initial={harvestOn ? req!.initial : null}
              creating={creating} createError={createErr} skipDisabled={sending || !!down}
              titleOf={vt.titleOf} titleLoading={vt.loading}
              onView={setView} forceEmpty={srcEmpty} onPageError={onPageError} onGone={() => { setReq(null); setView(null); clearGoalDraft(session.keyPrefix) }}
              onRetry={() => void startHarvest()} onSkip={() => void send(undefined, false)} />
          )}
        </section>

        <RouteStartSettings value={rs} onChange={changeSettings} dayMin={dayMin} onDayMin={changeDayMin} />

        <div className="st-bar">
          {failed ? <StartError err={err} down={down} refused={refused} /> : (
            <div className="st-sum">
              <span className="st-cnt">Выбрано: <b>{selectedCount}</b></span>
              <span className="mute">{levelSummary(effLevel)}</span>
              {selectedCount === 0 && <span className={'st-need' + (need ? ' on' : '')}>{NEED_GOAL_PROMPT}</span>}
            </div>
          )}
          <button type="submit" ref={goBtn} className="btn primary st-go" disabled={sending || !!down || harvestBusy}>
            {sending ? <><span className="spin" />Запускаем</> : failed ? 'Попробовать снова' : harvestOk ? `Начать маршрут (слова из ${(view ?? req!.initial)!.ready_count} роликов)` : 'Начать маршрут'}
          </button>
        </div>
      </form>

      {ask && (
        <div className="dlg-scrim">
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="st-ask-h">
            <h2 id="st-ask-h" className="serif">У Вас уже есть список известных слов</h2>
            <p>У этого ключа уже сохранён список слов, которые Вы знаете. Оставить его или заменить словами уровня {level}?</p>
            <div className="row">
              <button type="button" ref={dlgPrimary} className="btn primary" disabled={sending || !!down} onClick={() => void send('keep')}>Оставить мой список</button>
              <button type="button" className="btn" disabled={sending || !!down} onClick={() => void send('replace')}>Заменить</button>
            </div>
          </div>
        </div>
      )}

      {catalog && detail && (
        <TitleDetail key={detail.card.slug} card={detail.card} snapshot={detail.snapshot} selected={selectedSlugs.has(detail.card.slug)}
          capped={titles.length >= MAX_TITLES} onToggle={toggleTitle} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}

// GoalCard — карточка сериала (дизайн §3a): постер — отдельная кнопка выбора
// (aria-pressed), метка IMDb — своя зона нажатия, в новой вкладке.
function GoalCard({ goal: g, hue, on, onToggle }: { goal: Goal; hue: number; on: boolean; onToggle: () => void }) {
  const sub = [g.type, g.year ? String(g.year) : ''].filter(Boolean).join(' · ')
  return (
    <div className={'gc' + (on ? ' on' : '')}>
      <button type="button" className="gc-hit" aria-pressed={on} aria-label={g.title} onClick={onToggle}>
        <GoalPoster slug={g.poster_slug} title={g.title} hue={hue} on={on} />
      </button>
      <div className="gc-b">
        <div className="gc-t">{g.title}</div>
        {(sub || g.level) && (
          <div className="gc-s">{sub && <span>{sub}</span>}{g.level && <span className="gc-l">{g.level}</span>}</div>
        )}
        <div className="gc-a">
          {g.imdb_id && (
            <a className="imdb" href={imdbUrl(g.imdb_id)} target="_blank" rel="noopener noreferrer" aria-label={`${g.title} на IMDb`}>IMDb</a>
          )}
        </div>
      </div>
    </div>
  )
}

function YtThumb({ videoId }: { videoId: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="yt-th">
      {failed ? <CabI.play /> : <img src={ytThumb(videoId)} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}

function StartError({ err, down, refused }: { err: string | null; down: { until: number; banned: boolean; catalog?: boolean } | null; refused: boolean }) {
  const left = useCountdown(down && !down.banned && !down.catalog ? down.until : null)
  let body: ReactNode = err
  if (down) {
    if (down.catalog) {
      body = CATALOG_UNAVAILABLE_TEXT
    } else if (down.banned) {
      const d = new Date(down.until)
      body = `Слишком много действий с маршрутом, продолжим в ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } else {
      body = `Маршрут временно недоступен. Повторим через ${Math.max(1, left)} с`
    }
  } else if (refused) {
    body = <><span>Маршрут временно недоступен, мы уже знаем о проблеме</span>. <span>Поддержка: <SupportLink /></span></>
  }
  return <div className="msg err st-err" role="alert"><CabI.alert /><span>{body}</span></div>
}
