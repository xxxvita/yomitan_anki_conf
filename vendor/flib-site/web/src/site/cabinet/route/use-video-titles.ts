// use-video-titles.ts — названия роликов «Моих целей». Шлюз у целей-роликов
// название не заполняет, его узнаёт BFF (GET /api/me/route/video-titles).
// Узнанные названия и окончательные промахи живут в модуле до перезагрузки
// страницы; спрашиваются только неизвестные id, пачками не больше 50. id без
// ответа (`pending`, сбой сети, не-2xx, ответ не той формы) повторяются через
// 5 с, 15 с и 65 с, потом считаются «названия нет». После неудачи повтора
// через 15 с «Загружаем…» гаснет (показывается id), а повтор через 65 с идёт
// молча: если он удастся, название появится. Ошибка не показывается и
// страницу не трогает (onPageError сюда не доходит).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSession, sessionGen, subscribeSession } from '../../session'
import { routeApi } from './route-api'

const BATCH = 50
const RETRY_MS = [5_000, 15_000, 65_000]
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const known = new Map<string, string>()
const missed = new Set<string>()

// Кэши принадлежат одной сессии: название, узнанное ключом A, нельзя показывать
// ключу B (у него может быть иной вердикт шлюза). Личность — вошедший ключ плюс
// счётчик сессии (вход и выход меняют его, даже при общем префиксе).
let moduleIdent = ''
let generation = 0

function identityKey(): string {
  const s = getSession()
  const who = s.status !== 'ready' ? '?' : s.authenticated ? `in:${s.keyPrefix}` : 'out'
  return `${sessionGen()}|${who}`
}

function syncIdentity(cur: string): void {
  if (cur === moduleIdent) return
  moduleIdent = cur
  known.clear(); missed.clear()
  generation++
}

export function __resetVideoTitlesForTests(): void { known.clear(); missed.clear(); moduleIdent = ''; generation++ }

export interface VideoTitles {
  titleOf: (id: string) => string | null
  /** Название ещё узнаётся: id в наборе, ответа нет, повторы не исчерпаны. */
  loading: (id: string) => boolean
}

interface Inst {
  alive: boolean
  gen: number // поколение модуля, под которым накоплено состояние экземпляра
  ids: Set<string>
  inflight: Set<string>
  scheduled: Set<string>
  attempt: Map<string, number>
  gaveUp: Set<string>
  quiet: Set<string> // 15-секундный повтор не удался: показываем id, 65-секундный идёт молча
  timers: Set<ReturnType<typeof setTimeout>>
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function useVideoTitles(ids: string[], enabled: boolean): VideoTitles {
  const [, bump] = useState(0)
  const ref = useRef<Inst | null>(null)
  if (ref.current === null) {
    ref.current = { alive: true, gen: -1, ids: new Set(), inflight: new Set(), scheduled: new Set(), attempt: new Map(), gaveUp: new Set(), quiet: new Set(), timers: new Set() }
  }
  const inst = ref.current
  const ident = useSyncExternalStore(subscribeSession, identityKey, identityKey)
  syncIdentity(ident)
  if (inst.gen !== generation) {
    // Сессия сменилась: прежние запросы, повторы и итоги больше не наши.
    inst.timers.forEach(clearTimeout)
    inst.timers.clear(); inst.inflight.clear(); inst.scheduled.clear()
    inst.attempt.clear(); inst.gaveUp.clear(); inst.quiet.clear()
    inst.gen = generation
  }
  const valid = enabled ? Array.from(new Set(ids.filter(id => VIDEO_ID.test(id)))) : []
  inst.ids = new Set(valid)

  const ask = useCallback((batch: string[]) => {
    const s = ref.current!
    const gen0 = generation
    const settle = (chunk: string[], data: unknown) => {
      if (!s.alive || gen0 !== generation) return // ответ прежней сессии
      chunk.forEach(id => s.inflight.delete(id))
      const retry: string[] = []
      if (isPlain(data) && isPlain(data.titles) && Array.isArray(data.pending)) {
        const titles = data.titles
        const pending = new Set(data.pending.filter((x): x is string => typeof x === 'string'))
        for (const id of chunk) {
          const t = titles[id]
          if (typeof t === 'string' && t !== '') known.set(id, t)
          else if (pending.has(id)) retry.push(id)
          else missed.add(id)
        }
      } else {
        retry.push(...chunk) // не та форма ответа — как «не получилось»
      }
      // Ответ мог прийти после того, как ролик убрали: ему повтор не нужен.
      const byAttempt = new Map<number, string[]>()
      for (const id of retry.filter(i => s.ids.has(i))) {
        const n = s.attempt.get(id) ?? 0
        if (n >= RETRY_MS.length) { s.gaveUp.add(id); continue }
        s.attempt.set(id, n + 1)
        s.scheduled.add(id)
        if (n === RETRY_MS.length - 1) s.quiet.add(id)
        byAttempt.set(n, [...(byAttempt.get(n) ?? []), id])
      }
      byAttempt.forEach((group, n) => {
        const timer = setTimeout(() => {
          s.timers.delete(timer)
          group.forEach(id => s.scheduled.delete(id))
          if (!s.alive) return
          const again = group.filter(id => s.ids.has(id) && !known.has(id) && !missed.has(id) && !s.inflight.has(id))
          if (again.length > 0) ask(again)
          bump(x => x + 1)
        }, RETRY_MS[n])
        s.timers.add(timer)
      })
      bump(x => x + 1)
    }
    for (let i = 0; i < batch.length; i += BATCH) {
      const chunk = batch.slice(i, i + BATCH)
      chunk.forEach(id => s.inflight.add(id))
      routeApi.videoTitles(chunk).then(
        r => settle(chunk, r.ok ? r.data : null),
        () => settle(chunk, null),
      )
    }
  }, [])

  const key = [...valid].sort().join(',')
  useEffect(() => {
    if (!enabled) return
    const s = ref.current!
    // Набор изменился: ролики, на которых повторы кончились, можно спросить снова.
    const fresh = valid.filter(id => !known.has(id) && !missed.has(id) && !s.inflight.has(id) && !s.scheduled.has(id))
    fresh.forEach(id => { s.gaveUp.delete(id); s.quiet.delete(id); s.attempt.delete(id) })
    if (fresh.length > 0) { ask(fresh); bump(x => x + 1) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, ident])

  useEffect(() => {
    const s = ref.current!
    s.alive = true
    return () => {
      s.alive = false
      s.timers.forEach(clearTimeout)
      s.timers.clear(); s.scheduled.clear(); s.inflight.clear()
    }
  }, [])

  const titleOf = (id: string): string | null => known.get(id) ?? null
  const loading = (id: string): boolean =>
    enabled && inst.ids.has(id) && !known.has(id) && !missed.has(id) && !inst.gaveUp.has(id) && !inst.quiet.has(id)
  return { titleOf, loading }
}
