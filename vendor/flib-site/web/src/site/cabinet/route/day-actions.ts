// day-actions.ts — общий контракт действий экрана дня для героя и строк списка
// (план B10b): оценка, замена, раскрытые строки (одна на страницу), подписи.
import type { DayRow } from './day-model'
import type { Rating } from './route-ratings'
import type { ClipDislikeReason } from '../../../player/route-events/mapper'
import { plural } from '../../plural'

export type PanelKind = 'dislike' | 'replace'
// canReplace — право замены строки В МОМЕНТ ОТКРЫТИЯ: перечитанное состояние, у
// которого оно другое, закрывает строку (ревью 3а, C1).
export interface OpenPanel { kind: PanelKind; puzzleId: string; where: 'hero' | 'row'; canReplace: boolean }

export interface DayActions {
  busy: boolean                         // идёт обмен: оценка и замена неактивны
  replaceAvailable: boolean             // Г7 выкачена
  panel: OpenPanel | null
  notice: { text: string; anchor?: string } | null
  ratingOf: (puzzleId: string) => Rating | null
  like: (row: DayRow) => void
  dislike: (row: DayRow, where: 'hero' | 'row') => void
  replace: (row: DayRow, where: 'hero' | 'row') => void
  submitDislike: (row: DayRow, reason: ClipDislikeReason, replace: boolean) => void
  confirmReplace: (row: DayRow) => void
  closePanel: () => void
  next: () => void
  lessonHeard: (puzzleId: string) => number
}

export function lessonTitle(n: number): string {
  return `Урок слов · ${n} ${plural(n, 'слово', 'слова', 'слов')}`
}

export function minutesOf(sec: number): number {
  return sec > 0 ? Math.max(1, Math.round(sec / 60)) : 0
}

export function newWordsLabel(n: number): string {
  return `+${n} ${plural(n, 'новое слово', 'новых слова', 'новых слов')}`
}

// canReplaceRow — «Заменить» и галка у строки: Г7 и выданная строка ТЕКУЩЕГО плана, не урок слов.
export function canReplaceRow(row: DayRow, replaceAvailable: boolean): boolean {
  return replaceAvailable && row.inPlan && row.replaceable
}
