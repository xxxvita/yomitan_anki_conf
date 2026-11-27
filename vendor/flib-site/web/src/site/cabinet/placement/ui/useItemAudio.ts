// Звук задания: играет сам при показе задания (и при смене задания); ни разу не проигрался (failed) —
// onFail (экран отвечает skipped). Прервано (blur, скрытие, новое задание, NotAllowedError), в том числе
// посреди слова — не сбой: «на паузе» и «Повторить звук»; вернулся фокус или вид снова видим, а ответа
// ещё нет — звук играет сам. Файл не скачан (network) — НЕ пропуск: «Повторить», а после трёх подряд на
// этом задании — ещё и «Прервать тест» (netFails). StrictMode: эффект повторяется — первый play
// отменяется stop() в очистке, его исход не применяется (alive); повтор по кнопке сверяется с текущим
// заданием.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Player, PlayResult } from '../audio'

export type AudioState = 'loading' | 'played' | 'paused' | 'failed' | 'network'

export function useItemAudio(player: Player, url: string, itemKey: string, onFail: () => void): { state: AudioState; replay: () => void; netFails: number; heard: boolean } {
  const [state, setState] = useState<AudioState>('loading')
  const [netFails, setNetFails] = useState(0)
  const [heard, setHeard] = useState(false) // слово доиграно хотя бы раз: до этого отвечать нельзя
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const cur = useRef({ key: itemKey, heard: false, net: 0 })

  const apply = useCallback((key: string, r: PlayResult) => {
    if (cur.current.key !== key) return
    if (r === 'played') {
      cur.current.heard = true
      setHeard(true)
      cur.current.net = 0
      setNetFails(0)
      setState('played')
    } else if (r === 'failed') {
      setState('failed')
      if (!cur.current.heard) onFailRef.current()
    } else if (r === 'network') {
      cur.current.net += 1
      setNetFails(cur.current.net)
      setState('network')
    } else {
      setState('paused')
    }
  }, [])

  useEffect(() => {
    let alive = true
    cur.current = { key: itemKey, heard: false, net: 0 }
    setNetFails(0)
    setHeard(false)
    setState('loading')
    player.play(url).then((r) => { if (alive) apply(itemKey, r) })
    return () => {
      alive = false
      player.stop()
    }
  }, [player, url, itemKey, apply])

  const replay = useCallback(() => {
    const key = cur.current.key
    setState('loading')
    player.play(url).then((r) => apply(key, r))
  }, [player, url, apply])

  // Автоповтор после прерывания: фокус вернулся / вид снова видим. Только из 'paused' — доигранный звук,
  // сбой и сеть сами не повторяются. Пока вид скрыт, focus не повторяет (play всё равно отдал бы hidden).
  useEffect(() => {
    if (state !== 'paused') return undefined
    const resume = () => { if (document.visibilityState !== 'hidden') replay() }
    const onVis = () => { if (document.visibilityState === 'visible') resume() }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [state, replay])

  return { state, replay, netFails, heard }
}
