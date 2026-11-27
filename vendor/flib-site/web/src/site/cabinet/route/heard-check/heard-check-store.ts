// heard-check-store.ts — экран теста как внешнее хранилище: один открытый вопрос,
// один обещающий ответ. Читатели: HeardCheckHost (React), runHeardCheck (поток).
//
// ⚠️ ОДИН ТЕСТ ЗА РАЗ (E5). Новый вопрос при открытом прежнем НЕ закрывает
// прежний «Пропуском»: прежний ответ ушёл бы declined и погасил бы вопрос у
// демона. Вызывающий поток (runHeardCheck) сам сериализует входы; здесь второй
// вход получает 'abandoned' и ничего не показывает.
import { useSyncExternalStore } from 'react'
import type { HeardQuestion } from '../route-api'
import type { HeardAnswer } from './heard-check-event'

export type HeardOutcome = HeardAnswer | 'abandoned'

interface Pending { question: HeardQuestion; resolve: (r: HeardOutcome) => void }

let current: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of [...listeners]) l() }

export function askHeardCheck(question: HeardQuestion): Promise<HeardOutcome> {
  if (current) return Promise.resolve('abandoned')
  return new Promise<HeardOutcome>(resolve => {
    current = { question, resolve }
    emit()
  })
}

function settle(r: HeardOutcome): void {
  const p = current
  if (!p) return
  current = null
  emit()
  p.resolve(r)
}

// finishHeardCheck — человек нажал «Готово» / «Пропустить» / Esc.
export function finishHeardCheck(a: HeardAnswer): void { settle(a) }

// abandonHeardCheck — экран закрыт без ответа (уход со страницы, размонтирование):
// НИЧЕГО не отправляется (E4).
export function abandonHeardCheck(): void { settle('abandoned') }

export function currentHeardQuestion(): HeardQuestion | null { return current?.question ?? null }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useHeardQuestion(): HeardQuestion | null {
  return useSyncExternalStore(subscribe, currentHeardQuestion, currentHeardQuestion)
}
