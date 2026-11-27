// placement-entry.ts — общие правила входов в тест уровня: Главная, старт маршрута, «Мои знания» (спека §4 «Входы»).
import type { SessionSnapshot } from '../session'
import { cabinetRouteMarked } from './route/route-storage'
import type { PlacementSummary } from './placement/placement-api'
import { KEY_PREFIX_LATER } from './placement/site-host'

export type PlacementLast = NonNullable<PlacementSummary['last']>

/** Сводка теста нужна только при метке маршрута, активном ключе и праве маршрута (иначе — ни одного запроса). */
export function placementGate(s: SessionSnapshot): boolean {
  return cabinetRouteMarked() && s.state === 'active' && s.routeAllowed
}

/** Годный результат: валидный и непустой (иначе — обычный выбор уровня). */
export function usableResult(sum: PlacementSummary | undefined): PlacementLast | null {
  const l = sum?.last
  return l && l.valid && l.word_count > 0 ? l : null
}

/** A1→A1, A2→A2, B1+→B1 (уровень для запроса старта). */
export function requestLevel(level: string): 'A1' | 'A2' | 'B1' {
  return level === 'A1' ? 'A1' : level === 'A2' ? 'A2' : 'B1'
}

/** 1240 → «1 240» (обычные пробелы). */
export function ruInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Слов «уровня» результата: vocab_size, иначе число слов теста. */
export function approxWords(l: PlacementLast): number {
  return l.vocab_size ?? l.word_count
}

export function ruDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function laterGet(owner: string): boolean {
  try { return window.localStorage.getItem(KEY_PREFIX_LATER + owner) !== null } catch { return false }
}
export function laterSet(owner: string): void {
  try { window.localStorage.setItem(KEY_PREFIX_LATER + owner, '1') } catch { /* нет хранилища — до перезагрузки */ }
}
