// route-days.ts — чтение `GET /api/me/route/days` календарём вкладки (спека
// 2026-11-17 §4.12 «Чтения», M8, R2-L4, §7 случай 32; план B10c).
//
// Шлюз держит ОДИН запрос дней на ключ на поде (2 на под) и отвечает `429 busy`,
// поэтому вкладка держит не больше одного запроса в полёте. Нужные месяцы —
// «места»: вид календаря (`view`) и месяц выбранного прошлого дня (`sel`, ревью 3b
// R1-L4); из мест читается то, чего нет в кэше, по одному. Запрос — ровно один
// месяц (≤ 31 дня; 400 дней не помещаются в потолок чтения BFF). Месяцы
// кэшируются до смены «эпохи» — `route_id:revision` (коммит обмена, сброс, другой
// ключ): ответ, пришедший после смены эпохи, в кэш не ложится.
//
// Отказы — по классу ответа (§4.3, §5; ревью 3b L5, R1-L1):
//   • временный (`503 *`, `502` без JSON-кода BFF / `gateway_unavailable`, сеть) —
//     повтор сам: через Retry-After ЦЕЛИКОМ, а без него — 2, 4, 8 … ≤ 60 с;
//     календарь показывает «Маршрут временно недоступен. Повторим через N с»;
//   • `429` — сначала до BUSY_RETRIES повторов по Retry-After подряд, затем как
//     временный (Retry-After целиком);
//   • `502 gateway_refused` и незнакомый код — окончательный отказ, без повтора
//     (текст «мы уже знаем о проблеме»);
//   • `401`, `403` — без повтора, перечитать сессию (§3.3): страница покажет вход
//     или «ключ истёк»; `400`, `404` — без повтора, ячейки в виде ошибки.
// Повторы живут, только пока календарь подписан: последняя отписка снимает
// таймеры и сбрасывает отказы (вернувшийся календарь читает заново). Повтор
// разрешает таймер, а не сравнение с часами (таймер может сработать раньше).
import { useCallback, useEffect, useState } from 'react'
import { routeApi, retryDelaySec, type ApiResult } from './route-api'
import { monthRange, type DaysEntry } from './calendar-model'
import { BUSY_RETRIES } from './use-route-state'
import { refreshSession } from '../../session'

export interface DaysLoaderDeps {
  fetchDays: (from: string, to: string) => Promise<ApiResult<{ days: DaysEntry[] }>>
  sleep: (ms: number) => Promise<void>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  onAuth?: () => void
}

export const DAYS_RETRY_MAX_SEC = 60

export type MonthFailureKind = 'temporary' | 'refused' | 'stopped'
interface MonthFailure { kind: MonthFailureKind; n: number; until: number; ready: boolean; timer?: unknown }
export type DaysSlot = 'view' | 'sel'

function validDays(raw: unknown): DaysEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((d): d is DaysEntry => !!d && typeof d === 'object' && typeof (d as DaysEntry).date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test((d as DaysEntry).date) && Array.isArray((d as DaysEntry).clips))
}

export class DaysLoader {
  months = new Map<string, DaysEntry[]>()
  private epoch = ''
  private slots = new Map<DaysSlot, string>()
  private running = false
  private listeners = new Set<() => void>()
  private failures = new Map<string, MonthFailure>()

  constructor(private deps: DaysLoaderDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)() }

  // failure — отказ месяца, ещё не прочитанного (иначе null).
  failure(ym: string): { kind: MonthFailureKind; until: number } | null {
    if (this.months.has(ym)) return null
    const f = this.failures.get(ym)
    return f ? { kind: f.kind, until: f.until } : null
  }

  // failedUntil — месяц не прочитан после ВРЕМЕННОГО отказа: когда следующий повтор.
  failedUntil(ym: string): number | null {
    const f = this.failure(ym)
    return f && f.kind === 'temporary' ? f.until : null
  }

  setEpoch(key: string): void {
    if (key === this.epoch) return
    this.epoch = key
    this.months = new Map()
    this.clearFailures()
    this.notify()
    void this.pump()
  }

  // want — месяц нужен месту `slot` (null — месту больше не нужен).
  want(ym: string | null, slot: DaysSlot = 'view'): void {
    if (ym) this.slots.set(slot, ym)
    else this.slots.delete(slot)
    void this.pump()
  }

  busy(): boolean { return this.running }

  subscribe(fn: () => void): () => void {
    if (this.listeners.size === 0) this.clearFailures()
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
      // Календаря больше нет — повторы сняты, отказы забыты (ревью 3b, R1-L1).
      if (this.listeners.size === 0) this.clearFailures()
    }
  }

  private clearFailures(): void {
    const clear = this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    for (const f of this.failures.values()) if (f.timer !== undefined) clear(f.timer)
    this.failures = new Map()
  }

  private notify(): void { for (const fn of this.listeners) { try { fn() } catch { /* читатель не мешает */ } } }

  private next(): string | null {
    for (const ym of [this.slots.get('view'), this.slots.get('sel')]) {
      if (!ym || this.months.has(ym)) continue
      const f = this.failures.get(ym)
      if (!f || (f.kind === 'temporary' && f.ready)) return ym
    }
    return null
  }

  private fail(ym: string, epoch: string, r: Extract<ApiResult<unknown>, { ok: false }>): void {
    if (r.status === 401 || r.status === 403) {
      this.failures.set(ym, { kind: 'stopped', n: 0, until: 0, ready: false })
      ;(this.deps.onAuth ?? (() => { void refreshSession().catch(() => undefined) }))()
      return
    }
    if (r.cls === 'refused') { this.failures.set(ym, { kind: 'refused', n: 0, until: 0, ready: false }); return }
    if (r.cls !== 'temporary' && r.cls !== 'rate') { this.failures.set(ym, { kind: 'stopped', n: 0, until: 0, ready: false }); return }
    const n = (this.failures.get(ym)?.n ?? 0) + 1
    const sec = r.retryAfterSec && r.retryAfterSec > 0 ? r.retryAfterSec : Math.min(2 ** n, DAYS_RETRY_MAX_SEC)
    const f: MonthFailure = { kind: 'temporary', n, until: this.now() + sec * 1000, ready: false }
    this.failures.set(ym, f)
    if (this.listeners.size === 0) return // некому показывать: без повтора; вернувшийся календарь читает заново
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    f.timer = set(() => {
      f.timer = undefined
      if (epoch !== this.epoch || this.failures.get(ym) !== f) return
      f.ready = true
      void this.pump()
    }, sec * 1000)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let ym = this.epoch ? this.next() : null; ym; ym = this.epoch ? this.next() : null) {
        const epoch = this.epoch
        const prev = this.failures.get(ym)
        if (prev) prev.ready = false
        const { from, to } = monthRange(ym)
        let r = await this.deps.fetchDays(from, to)
        for (let i = 0; !r.ok && r.status === 429 && i < BUSY_RETRIES && epoch === this.epoch; i++) {
          await this.deps.sleep(retryDelaySec(r) * 1000)
          if (epoch !== this.epoch) break
          r = await this.deps.fetchDays(from, to)
        }
        if (epoch !== this.epoch) continue
        if (r.ok) {
          this.months.set(ym, validDays(r.data?.days))
          this.failures.delete(ym)
        } else {
          this.fail(ym, epoch, r)
        }
        this.notify()
      }
    } finally {
      this.running = false
    }
  }
}

let instance: DaysLoader | null = null

// getDaysLoader — один загрузчик на вкладку (один запрос дней в полёте).
export function getDaysLoader(): DaysLoader {
  return instance ??= new DaysLoader({
    fetchDays: (from, to) => routeApi.days(from, to) as Promise<ApiResult<{ days: DaysEntry[] }>>,
    sleep: ms => new Promise(r => setTimeout(r, Math.max(0, ms))),
  })
}

export function __resetDaysLoaderForTests(): void { instance = null }

// useRouteDays — прочитанные месяцы для календаря; эпоха — `route_id:revision`.
export function useRouteDays(epoch: string): {
  months: ReadonlyMap<string, DaysEntry[]>
  want: (ym: string | null, slot?: DaysSlot) => void
  failedUntil: (ym: string) => number | null
  failure: (ym: string) => { kind: MonthFailureKind; until: number } | null
} {
  const loader = getDaysLoader()
  const [, setTick] = useState(0)
  useEffect(() => loader.subscribe(() => setTick(t => t + 1)), [loader])
  useEffect(() => { loader.setEpoch(epoch) }, [loader, epoch])
  const want = useCallback((ym: string | null, slot?: DaysSlot) => loader.want(ym, slot), [loader])
  const failedUntil = useCallback((ym: string) => loader.failedUntil(ym), [loader])
  const failure = useCallback((ym: string) => loader.failure(ym), [loader])
  return { months: loader.months, want, failedUntil, failure }
}
