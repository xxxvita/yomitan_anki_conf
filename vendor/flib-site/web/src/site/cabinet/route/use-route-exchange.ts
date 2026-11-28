// use-route-exchange.ts — обмен страницы маршрута (спека 2026-11-17 §4.6, план
// B10a/B10b): машина обмена B7 + состояние экрана (что идёт, фаза, итог).
//
// Виды запуска (kind) решают, что делать по коммиту (§4.6 п.4, W-M2):
//   • 'next_clip' — «Следующий ролик» (герой или `?next=` из плеера / урока):
//     выдан новый YouTube-ролик — сразу плеер с `rp`; урок слов и `other` —
//     остаться на экране дня (страница урока сама не открывается, Р27);
//   • 'replace' — замена: вспышка героя и строка «День подобран заново…» до
//     следующего обмена (§4.12 «Коммит»);
//   • прочие (старт, «Начать день», «Получить ролики на сегодня», повтор,
//     возобновление) — экран дня.
// Итоги без коммита — уведомление на экране (§4.6 п.4–5), без автоповтора.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  browserExchangeDeps, pollJob, runExchange,
  type ExchangeDeps, type ExchangeOutcome, type ExchangePhase, type ExchangeRequest,
} from './exchange-machine'
import { forDate } from './learning-day'
import { getRouteOutbox } from './outbox'
import { broadcastRouteRevision, invalidateRouteStateRead, type StateRead } from './use-route-state'
import { buildDayModel } from './day-model'
import { canReplaceRow } from './day-actions'
import { localDayInputs } from './local-inputs'
import { dropReplacedLocally, epochOf, markReplaced } from './replace-flow'
import type { RouteState } from './route-api'
import { refreshSession } from '../../session'

export type ExchangeKind = 'next_clip' | 'start_day' | 'new_day' | 'retry' | 'replace' | 'resume' | 'quick'

export interface ExchangeNotice {
  text: string
  support?: boolean
  // action — кнопка под уведомлением: повторить тот же обмен / подобрать заново.
  action?: 'repeat' | 'restart'
  // anchor — puzzle_id строки (или 'hero'), под которой показать уведомление замены.
  anchor?: string
}

export interface RunningExchange { kind: ExchangeKind; replacePid?: string; anchor?: string }

export interface ExchangeView {
  running: RunningExchange | null
  phase: ExchangePhase | null
  notice: ExchangeNotice | null
  replanned: boolean
  flashKey: number
  lastErrorCode: string | null
  // pageError — 403 обмена: ключ истёк / нет права (страница покажет экран).
  pageError: string | null
}

export interface ExchangeHookDeps {
  sleep?: (ms: number) => Promise<void>
}

interface CurrentMark { pid: string | null; day: string | null }
const markOf = (st: RouteState | null): CurrentMark => ({ pid: st?.current_puzzle_id ?? null, day: st?.day?.date ?? null })

export const UNAVAILABLE_TEXT = 'Маршрут временно недоступен, мы уже знаем о проблеме'
// REPLACE_STALE_TEXT — замена не выполнена: день успел измениться (409 stale_revision
// или закоммитился чужой обмен, 409 exchange_in_progress; ревью 3а, L1).
export const REPLACE_STALE_TEXT = 'День изменился, пока шла замена, — замена не выполнена. Проверьте список и повторите, если нужно'
export const REPLACE_UNAVAILABLE_TEXT = 'Замена сейчас недоступна'
export const STATE_CHECK_FAILED_TEXT = 'Не удалось проверить маршрут. Попробуйте ещё раз'

export function useRouteExchange(o: {
  reload: () => Promise<StateRead>
  onNavigate: (url: string) => void
  deps?: ExchangeHookDeps
}) {
  const [view, setView] = useState<ExchangeView>({ running: null, phase: null, notice: null, replanned: false, flashKey: 0, lastErrorCode: null, pageError: null })
  const signal = useRef({ aborted: false })
  const busy = useRef(false)
  // last — запрос, который ЭТА вкладка отправила последним (читатель — «Повторить»).
  // Опрос чужого обмена его стирает: «Повторить» не повторяет то, чего вкладка не
  // начинала (ревью 3а, R1-C1).
  // forCurrent — текущий ролик (`current_puzzle_id`) и дата плана состояния, с
  // которого запрос отправлен: «Повторить» `next` уходит, только если в СВЕЖЕМ
  // состоянии и текущий, и дата плана те же (ревью 3а, R2-L1/R2-L2; 3b, L7: id урока
  // слов детерминирован и повторяется в плане нового дня) — иначе `next` пропустил
  // бы неоткрытый ролик.
  const last = useRef<{ kind: ExchangeKind; req: Omit<ExchangeRequest, 'expectedRevision' | 'snapshotDate'>; anchor?: string; forCurrent: CurrentMark } | null>(null)
  const oRef = useRef(o)
  oRef.current = o

  useEffect(() => {
    signal.current = { aborted: false }
    return () => { signal.current.aborted = true }
  }, [])

  const deps = useCallback((): ExchangeDeps => {
    const d = browserExchangeDeps({
      // Машина обмена читает состояние только после события на шлюзе (коммит,
      // конфликт, ожидание Retry-After): запрос в полёте мог уйти ДО него —
      // свой запрос, не присоединяясь (финальное ревью PR-B, L6).
      readState: async () => { invalidateRouteStateRead(); return (await oRef.current.reload()).result },
      outbox: getRouteOutbox(),
      broadcast: broadcastRouteRevision,
      forDate: sd => forDate(sd),
      onPhase: p => { if (!signal.current.aborted) setView(v => ({ ...v, phase: p })) },
      signal: signal.current,
    })
    const sleep = oRef.current.deps?.sleep
    return sleep ? { ...d, sleep } : d
  }, [])

  const settle = useCallback(async (kind: ExchangeKind, prev: RouteState | null, out: ExchangeOutcome, anchor?: string) => {
    if (signal.current.aborted || out.type === 'cancelled') return
    let notice: ExchangeNotice | null = null
    let replanned: boolean | null = null
    let flash = false
    let code: string | null | undefined
    let pageError: string | null = null
    switch (out.type) {
      case 'committed': {
        if (kind === 'replace' && out.foreign) {
          // Закоммитился чужой обмен, наша замена не выполнена: ни «День подобран
          // заново», ни вспышки — сообщение и свежее состояние.
          notice = { text: REPLACE_STALE_TEXT }
          if (!out.state) await oRef.current.reload()
          break
        }
        if (kind === 'replace') {
          replanned = true; flash = true
          // Пометка «заменён» — только после НАШЕЙ закоммиченной замены (R1-H1).
          const pid = last.current?.req.replacePuzzleId
          const ep = prev ? epochOf(prev) : undefined
          if (pid && ep) await markReplaced(pid, ep)
        }
        const next = out.state
        if (kind === 'next_clip' && next && next.current_puzzle_id && next.current_puzzle_id !== prev?.current_puzzle_id) {
          const row = next.day?.clips.find(c => c.delivered === true && c.puzzle_id === next.current_puzzle_id)
          const isYoutube = row && row.delivered === true && next.current_puzzle_id.startsWith('youtube::') && (row as { video_id?: string }).video_id
          if (isYoutube) {
            const v = (row as { video_id: string }).video_id
            oRef.current.onNavigate(`/player?v=${encodeURIComponent(v)}&rp=${encodeURIComponent(next.current_puzzle_id)}`)
          }
        }
        if (!out.state) await oRef.current.reload()
        break
      }
      case 'advanced': break
      case 'no_clip': notice = { text: 'Не удалось подобрать ролик' }; code = out.code; await oRef.current.reload(); break
      case 'unavailable': notice = { text: UNAVAILABLE_TEXT, support: true }; code = 'commit_failed'; break
      case 'refused': notice = { text: UNAVAILABLE_TEXT, support: true }; break
      case 'retry_offer': notice = { text: 'Не удалось подобрать ролик', ...(last.current ? { action: 'repeat' as const } : {}) }; code = out.code; await oRef.current.reload(); break
      case 'timeout': notice = { text: 'Подбор занял слишком много времени', action: 'restart' }; break
      case 'replace_unavailable': notice = { text: 'Замена сейчас недоступна', anchor }; break
      case 'snapshot_required': notice = { text: 'Замена станет доступна после первого ролика', anchor }; break
      case 'session':
        if (out.status === 401) void refreshSession().catch(() => undefined)
        else pageError = out.code ?? 'forbidden'
        break
      case 'reread':
        if (kind === 'replace' && out.code === 'stale_revision') notice = { text: REPLACE_STALE_TEXT }
        break
      default: await oRef.current.reload()
    }
    setView(v => ({
      ...v, running: null, phase: null, notice,
      replanned: replanned === null ? v.replanned : replanned,
      flashKey: flash ? v.flashKey + 1 : v.flashKey,
      lastErrorCode: code === undefined ? v.lastErrorCode : code,
      pageError,
    }))
  }, [])

  // run — обмен с текущего состояния. Повторное нажатие, пока идёт обмен, не шлётся.
  const run = useCallback(async (kind: ExchangeKind, state: RouteState, req: Omit<ExchangeRequest, 'expectedRevision' | 'snapshotDate'>, extra: { anchor?: string; before?: () => Promise<void> } = {}): Promise<void> => {
    if (busy.current) return
    busy.current = true
    last.current = { kind, req, anchor: extra.anchor, forCurrent: markOf(state) }
    setView(v => ({ ...v, running: { kind, replacePid: req.replacePuzzleId, anchor: extra.anchor }, phase: { kind: 'flushing' }, notice: null, replanned: kind === 'replace' ? v.replanned : false, pageError: null }))
    try {
      if (extra.before) await extra.before()
      // Шаги замены (§4.6 п.2) — здесь, чтобы «Повторить» шёл тем же путём.
      if (kind === 'replace' && req.replacePuzzleId) await dropReplacedLocally(req.replacePuzzleId)
      const out = await runExchange({ ...req, expectedRevision: state.revision, snapshotDate: state.snapshot_date }, deps())
      await settle(kind, state, out, extra.anchor)
    } finally {
      busy.current = false
    }
  }, [deps, settle])

  // poll — опрос уже созданного обмена (быстрый старт, active_exchange).
  const poll = useCallback(async (kind: ExchangeKind, state: RouteState | null, jobId: string, baseRevision: number): Promise<void> => {
    if (busy.current) return
    busy.current = true
    // Опрошенный обмен начат не этой кнопкой: «Повторить» после него — только
    // своего быстрого старта (его шаг обмена — `next`, отправлен, когда маршрута не
    // было: текущего ролика нет); чужой не повторяется.
    last.current = kind === 'quick' ? { kind: 'quick', req: { want: 'next' }, forCurrent: { pid: null, day: null } } : null
    setView(v => ({ ...v, running: { kind }, phase: { kind: 'polling', jobId }, notice: null, pageError: null }))
    try {
      const out = await pollJob(jobId, baseRevision, deps())
      await settle(kind, state, out)
    } finally {
      busy.current = false
    }
  }, [deps, settle])

  // repeat — «Повторить»: сначала свежее состояние; сохранённая замена уходит, только
  // если её ролик заменяем по НЕМУ (R1-C1), иначе обмена нет и «Замена сейчас
  // недоступна»; сохранённый `next` — только если текущий ролик в нём тот же, что при
  // отправке (R2-L1/R2-L2), иначе обмена нет и на экране свежий день. Без
  // сохранённого запроса — ничего.
  const repeat = useCallback(async (_state?: RouteState) => {
    const l = last.current
    if (!l || busy.current) return
    invalidateRouteStateRead()
    const fresh = await oRef.current.reload()
    if (signal.current.aborted) return
    if (!fresh.result.ok) { setView(v => ({ ...v, notice: { text: STATE_CHECK_FAILED_TEXT, action: 'repeat' } })); return }
    const st = fresh.result.data
    const fresh0 = markOf(st)
    if (l.req.want === 'next' && (fresh0.pid !== l.forCurrent.pid || (l.forCurrent.pid !== null && fresh0.day !== l.forCurrent.day))) {
      // День ушёл вперёд (другая вкладка выдала ролик, быстрый старт присоединился к
      // чужому обмену): `next` пропустил бы неоткрытый ролик — показываем свежий день.
      last.current = null
      setView(v => ({ ...v, notice: null }))
      return
    }
    if (l.req.want === 'replace') {
      const pid = l.req.replacePuzzleId
      const row = st.day ? buildDayModel(st, localDayInputs(st, fresh.sent)).rows.find(r => r.puzzleId === pid) : undefined
      if (!pid || !row || !canReplaceRow(row, st.replace_available)) {
        last.current = null
        setView(v => ({ ...v, notice: { text: REPLACE_UNAVAILABLE_TEXT } }))
        return
      }
    }
    await run(l.kind, st, l.req, { anchor: l.anchor })
  }, [run])

  const clearNotice = useCallback(() => setView(v => ({ ...v, notice: null })), [])

  return { view, run, poll, repeat, clearNotice, isBusy: () => busy.current }
}
