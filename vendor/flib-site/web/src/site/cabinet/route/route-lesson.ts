// route-lesson.ts — чтение `flib:route-lesson` (спека 2026-11-17 §4.13, §6.2).
//
// Форма: `{v:1, route_id, day:"YYYY-MM-DD", items:{<puzzle_id урока>:{heard:[слово…]}}}`;
// другой `route_id` или другая дата плана — содержимое не читается. Пишет
// страница урока (B10f). Здесь — только читатель экрана дня: текст кнопки урока
// «Продолжить урок», когда просмотрено хоть одно слово (W-L3).
import { ROUTE_LESSON_KEY, safeLocalStorage } from './route-storage'

export function lessonHeardCount(routeId: string | null, day: string | null, puzzleId: string, storage: Storage | null = safeLocalStorage()): number {
  if (!storage || !routeId || !day) return 0
  try {
    const raw = storage.getItem(ROUTE_LESSON_KEY)
    if (!raw) return 0
    const v = JSON.parse(raw) as { v?: unknown; route_id?: unknown; day?: unknown; items?: Record<string, { heard?: unknown }> }
    if (v?.v !== 1 || v.route_id !== routeId || v.day !== day || !v.items || typeof v.items !== 'object') return 0
    const heard = v.items[puzzleId]?.heard
    return Array.isArray(heard) ? heard.filter(w => typeof w === 'string' && w !== '').length : 0
  } catch {
    return 0
  }
}
