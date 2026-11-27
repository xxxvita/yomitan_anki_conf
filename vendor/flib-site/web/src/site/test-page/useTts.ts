// useTts.ts — озвучка стимулов теста через наш бэк (Э4, план
// docs/plan-2026-07-13-design-transfer.md «Архитектурные решения» п.1:
// клиент ходит только в internal/bff, ключ/gateway ему не виден).
//
// Контракт бэка (internal/bff/tts.go, уже реализован Э3): POST /api/tts
// {"text"} → стримит audio/mpeg тело напрямую (НЕ JSON с URL) — поэтому
// здесь `res.blob()`, а не `res.json()`.
//
// Состояния (DESIGN_SPEC.md §0.3/§0.4, temp/flib/test.jsx useAudioItem):
// idle → loading → playing → ready, либо → error. Пока loading/playing —
// элементы ответа экрана обязаны быть disabled (правило блокировки ответа,
// §0.4) — это соблюдают вызывающие экраны (audio.state !== 'ready'), не
// сам хук.
//
// Лимит повторов: 2 клика «Повторить» на айтем (счётчик repeats, см.
// DESIGN_SPEC §0.3). Кэш blob по тексту — module-level Map (не per-hook),
// переживает смену айтема/размонтирование экрана: повторные стимулы
// (например то же слово в двух прогонах) не бьют по TTS-квоте на клиенте
// повторным сетевым запросом, а бэк дополнительно кэширует на своей
// стороне (gateway, SHA-256(voice+body)) — это тот же принцип, применённый
// на ещё один уровень выше.
//
// Fallback-голос: DESIGN_SPEC.md таблица §8 — "TTS/Gateway не ответил →
// мягкая плашка + fallback-голос". Реализовано как переключение на
// браузерный SpeechSynthesis (en-US) по клику «Повторить» на плашке
// ошибки (TtsAlert зовёт retry()) — так же, как test.jsx: `retry = () =>
// run(false)` там был "запасной прогон", здесь это буквально запасной голос,
// раз реального fallback-голоса на бэке нет.
import { useEffect, useRef, useState } from 'react'

export type TtsState = 'idle' | 'loading' | 'playing' | 'ready' | 'error'

const REPEAT_LIMIT = 2

// Кэш blob по тексту — переживает пере-рендеры и размонтирование хуков
// (module-level, не useRef/useState).
const blobCache = new Map<string, Blob>()

export interface UseTtsOptions {
  /** Если true — хук не проигрывает автоматически при монтировании/смене
   *  text, вызывающий код сам зовёт play() (нужно StartScreen: "Проверить
   *  звук" — озвучка идёт только по клику, не сама по себе). */
  manual?: boolean
  voiceId?: string
}

export interface UseTtsResult {
  state: TtsState
  repeats: number
  repeatsLeft: number
  /** true, если сейчас звучит браузерный fallback-голос, не TTS с бэка
   *  (плашка ошибки показывает это иначе, чем обычное "ready"). */
  usingFallbackVoice: boolean
  play: () => void
  replay: () => void
  /** После ошибки: переключиться на fallback-голос (DESIGN_SPEC: клик
   *  «Повторить» на плашке = "включим запасной голос"). */
  retry: () => void
}

function speechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance !== 'undefined'
}

export function useTts(text: string, options: UseTtsOptions = {}): UseTtsResult {
  const { manual = false, voiceId } = options
  const [state, setState] = useState<TtsState>('idle')
  const [repeats, setRepeats] = useState(0)
  const [usingFallbackVoice, setUsingFallbackVoice] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const generation = useRef(0)

  function cleanupAudio() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  async function run(currentText: string) {
    const myGeneration = ++generation.current
    setUsingFallbackVoice(false)
    setState('loading')
    try {
      let blob = blobCache.get(currentText)
      if (!blob) {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(voiceId ? { text: currentText, voice_id: voiceId } : { text: currentText }),
        })
        if (!res.ok) throw new Error(`tts ${res.status}`)
        blob = await res.blob()
        blobCache.set(currentText, blob)
      }
      if (myGeneration !== generation.current) return // текст сменился, пока ждали ответ — не применяем устаревший результат
      cleanupAudio()
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      const audio = new Audio(url)
      audio.onended = () => { if (myGeneration === generation.current) setState('ready') }
      audioRef.current = audio
      setState('playing')
      try {
        await audio.play()
      } catch (err) {
        // jsdom не реализует play() (NotSupportedError) — в тестах 'ended'
        // шлют вручную на замоканном Audio, состояние не трогаем. А вот
        // РЕАЛЬНЫЙ отказ браузера (NotAllowedError: autoplay-политика — user
        // activation истекает, пока fetch тянет blob) обязан уронить state в
        // 'error': иначе он вечно висит в 'playing', кнопки ответов
        // заблокированы, а плашка с fallback-голосом так и не появляется.
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          if (myGeneration === generation.current) setState('error')
          return
        }
      }
    } catch {
      if (myGeneration === generation.current) setState('error')
    }
  }

  useEffect(() => {
    if (manual) return
    void run(text)
    return () => { generation.current++; cleanupAudio() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезапуск строго по смене текста, run пересоздавать не нужно
  }, [text, manual])

  useEffect(() => cleanupAudio, [])

  useEffect(() => {
    setRepeats(0)
  }, [text])

  function play() {
    void run(text)
  }

  function replay() {
    if (repeats >= REPEAT_LIMIT) return
    if (state === 'loading' || state === 'playing') return
    setRepeats(r => r + 1)
    if (audioRef.current && state === 'ready' && !usingFallbackVoice) {
      // Уже загружено — повтор без похода в сеть.
      const myGeneration = generation.current
      setState('playing')
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => { /* см. run() */ })
      audioRef.current.onended = () => { if (myGeneration === generation.current) setState('ready') }
    } else {
      void run(text)
    }
  }

  function retry() {
    // Аудит MED #7: раньше retry() не звало cleanupAudio() — objectURL от
    // предыдущего run() (NotAllowedError→retry) утекал, потому что
    // fallback-голос никогда не создаёт новый <audio>/objectURL, которые
    // могли бы вытеснить старый через обычный cleanupAudio() внутри run().
    cleanupAudio()
    if (!speechSynthesisAvailable()) {
      // Нет и браузерного голоса — не блокируем пользователя навсегда,
      // просто отпускаем состояние в 'ready' (best-effort, см. DESIGN_SPEC
      // §8: технические ошибки не должны быть тупиком).
      setState('ready')
      return
    }
    const myGeneration = ++generation.current
    setUsingFallbackVoice(true)
    setState('playing')
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'en-US'
    utter.onend = () => { if (myGeneration === generation.current) setState('ready') }
    utter.onerror = () => { if (myGeneration === generation.current) setState('ready') }
    window.speechSynthesis.speak(utter)
  }

  return {
    state,
    repeats,
    repeatsLeft: Math.max(0, REPEAT_LIMIT - repeats),
    usingFallbackVoice,
    play,
    replay,
    retry,
  }
}
