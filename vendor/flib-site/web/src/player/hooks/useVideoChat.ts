// useVideoChat.ts — T1a «видео-примеры по слову»: держит состояние боковой
// панели «Чат: Видео» (открыта/слово/статус загрузки/карточки), сама ходит в
// examples-api. Самодостаточный хук — тот же принцип, что VideoVoteBar/
// RouteStepBar (PlayerPage.tsx doc-комментарии): PlayerPage передаёт только
// то, что нужно ДЛЯ ВЫЗОВА (word+kind из клика по попапу), не трогает сеть.
import { useCallback, useState } from 'react'
import { fetchExamples, type ExampleItem, type ExamplesKind } from '../examples-api'

export type VideoChatStatus = 'idle' | 'loading' | 'ok' | 'not_ready' | 'error'

export interface VideoChatState {
  open: boolean
  word: string | null
  kind: ExamplesKind | null
  status: VideoChatStatus
  items: ExampleItem[]
  errorMessage: string | null
}

const IDLE_STATE: VideoChatState = { open: false, word: null, kind: null, status: 'idle', items: [], errorMessage: null }

export function useVideoChat() {
  const [state, setState] = useState<VideoChatState>(IDLE_STATE)

  // requestExamples — открывает панель СРАЗУ (loading), ответ прилетает позже.
  // Stale-guard в .then: если пока запрос летел, пользователь кликнул ДРУГОЕ
  // слово/kind (новый requestExamples успел сменить state.word/kind), поздний
  // ответ на старый запрос молча игнорируется — иначе быстрый двойной клик
  // "controlled" → "amazing" мог бы откатить панель обратно на "controlled",
  // если первый (уже неактуальный) ответ прилетит ПОСЛЕ второго.
  const requestExamples = useCallback((word: string, kind: ExamplesKind) => {
    setState({ open: true, word, kind, status: 'loading', items: [], errorMessage: null })
    fetchExamples(word, kind).then(result => {
      setState(s => {
        if (s.word !== word || s.kind !== kind) return s
        if (result.status === 'ok') return { ...s, status: 'ok', items: result.items, errorMessage: null }
        if (result.status === 'not_ready') return { ...s, status: 'not_ready', items: [], errorMessage: null }
        return { ...s, status: 'error', items: [], errorMessage: result.message }
      })
    })
  }, [])

  // close — только скрывает панель (open:false), НЕ сбрасывает word/items:
  // повторное открытие тем же тумблером (toggleOpen) показывает последний
  // результат без повторного похода в сеть.
  const close = useCallback(() => setState(s => ({ ...s, open: false })), [])

  // toggleOpen — ручной тумблер из топбара (кнопка "Чат: Видео"), независим
  // от того, был ли уже клик по слову — если ничего не запрашивалось,
  // панель откроется в status='idle' (VideoChatPanel показывает подсказку).
  const toggleOpen = useCallback(() => setState(s => ({ ...s, open: !s.open })), [])

  return { state, requestExamples, close, toggleOpen }
}
