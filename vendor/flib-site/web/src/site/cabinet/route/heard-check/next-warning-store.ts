// next-warning-store.ts — предупреждение «Вы прослушали не весь ролик» как внешнее
// хранилище: одно открытое окно, один обещающий ответ (по образцу heard-check-store).
//   'proceed'   — «Всё равно перейти к следующему ролику»;
//   'stay'      — «Вернуться к ролику» / Esc;
//   'abandoned' — окно закрыто уходом со страницы, либо второй вход при открытом
//                 окне (второе окно не открывается; вызывающий не делает ничего).
import { useSyncExternalStore } from 'react'

export type NextWarnOutcome = 'proceed' | 'stay' | 'abandoned'

let open: { resolve: (r: NextWarnOutcome) => void } | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of [...listeners]) l() }

export function askNextWarning(): Promise<NextWarnOutcome> {
  if (open) return Promise.resolve('abandoned')
  return new Promise<NextWarnOutcome>(resolve => { open = { resolve }; emit() })
}

function settle(r: NextWarnOutcome): void {
  const p = open
  if (!p) return
  open = null
  emit()
  p.resolve(r)
}

export function finishNextWarning(r: 'proceed' | 'stay'): void { settle(r) }
export function abandonNextWarning(): void { settle('abandoned') }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => open !== null
export function useNextWarningOpen(): boolean { return useSyncExternalStore(subscribe, snapshot, snapshot) }
