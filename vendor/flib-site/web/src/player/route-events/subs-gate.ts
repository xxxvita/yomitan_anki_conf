// subs-gate.ts — первый просмотр ролика маршрута без субтитров (спека 2026-11-17
// §4.7 «Первый просмотр без субтитров», план B8b). Порт логики
// `route-subs-gate.ts` + `use-subs-clip-facts.ts` приложения.
//
// Пять пунктов спеки:
//   1. Действует в маршрутном режиме И пока первый проход не окончен. Окончен —
//      ролик `played` в дне маршрута ИЛИ отметка `flib:route-listened`.
//      `queued_played` гейт НЕ снимает. ⚠️ Отличие от приложения, НАМЕРЕННОЕ:
//      пока проверка маршрутного режима не ответила (`pending`), гейт включён —
//      у сайта `rp` ставит только страница маршрута, а ожидание ≤ 15 с (§10 Р16).
//   2. Включение — предупреждение [Хорошо] [Всё равно показать]; согласие помнится
//      на ролик в памяти вкладки.
//   3. Сохранённый режим `flib:subMode` только ЗАСЛОНЯЕТСЯ (`hidden` в него гейт не
//      пишет); «Всё равно показать» применяет и сохраняет выбранный человеком режим.
//   4. Размытие по словам — принудительное, независимо от режима (SubtitleOverlay).
//   5. Русская строка скрыта весь первый проход, до и после согласия, везде.
import type { SubtitleMode } from '../components/subtitle-drag'

export type RouteModeKind = 'off' | 'pending' | 'confirmed'

export interface SubsGateFacts {
  routeMode: RouteModeKind
  // played — строка ролика в дне маршрута (`day.clips[].played`), а не плеер.
  played: boolean
  // listened — клиентская отметка «прослушан» (`flib:route-listened`).
  listened: boolean
  puzzleId: string
}

// Согласие «Всё равно показать» — память вкладки, ключ — ролик.
const acked = new Set<string>()

export function ackSubsWarning(puzzleId: string): void {
  const v = (puzzleId ?? '').trim()
  if (v) acked.add(v)
}

export function isSubsWarningAcked(puzzleId: string | null | undefined): boolean {
  const v = (puzzleId ?? '').trim()
  return v !== '' && acked.has(v)
}

export function __forgetSubsWarningsForTests(): void { acked.clear() }

// firstPass — правило действует (п.1).
export function firstPass(f: SubsGateFacts): boolean {
  return f.routeMode !== 'off' && !f.played && !f.listened
}

// subsModeForClip — режим, который показать (п.3: сохранённый заслоняется, не перезаписывается).
export function subsModeForClip(f: SubsGateFacts, saved: SubtitleMode): SubtitleMode {
  if (!firstPass(f)) return saved
  if (isSubsWarningAcked(f.puzzleId)) return saved
  return 'hidden'
}

// subsPillIntent — нажатие на режим: включение на первом проходе без согласия —
// сперва предупреждение (п.2). «Скрыть» — применить сразу.
export function subsPillIntent(target: SubtitleMode, f: SubsGateFacts): 'apply' | 'warn' {
  if (target === 'hidden') return 'apply'
  if (!firstPass(f)) return 'apply'
  if (isSubsWarningAcked(f.puzzleId)) return 'apply'
  return 'warn'
}

// forcedBlur — размытие по словам обязано стоять (п.4).
export function forcedBlur(f: SubsGateFacts): boolean { return firstPass(f) }

// ruHidden — русская строка скрыта весь первый проход (п.5).
export function ruHidden(f: SubsGateFacts): boolean { return firstPass(f) }
