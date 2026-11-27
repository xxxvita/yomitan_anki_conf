// S0 (спека §5.3): самооценка → prior движка, проверка звука одним словом. Старт — только с ответом про
// английский и подтверждённым звуком: тест идёт на слух. «Не слышу», сбой звука и сеть — подсказка, старт
// закрыт. Слово проверки качается заранее (preload), поэтому нажатие «Проверить звук» запускает звук
// внутри самого нажатия (iOS). Браузер без Ogg Opus — сообщение вместо начала теста (Р-8).
import { useEffect, useRef, useState } from 'react'
import type { Player } from '../audio'
import { t, type Lang } from '../i18n'

export const PRIORS = ['zero', 'school', 'subs', 'no_subs'] as const
export type Prior = typeof PRIORS[number]

type Sound = 'idle' | 'playing' | 'ask' | 'ok' | 'notHeard' | 'failed' | 'network' | 'hidden' | 'cancelled'

export interface S0Props {
  lang: Lang
  player: Player
  testUrl: string
  busy?: boolean
  /** Ключ i18n сообщения над экраном («Тест обновился…»). */
  notice?: string
  /** false — браузер не играет Ogg Opus: вместо теста сообщение. */
  supported?: boolean
  onStart: (prior: Prior) => void
}

export function S0SelfCheck({ lang, player, testUrl, busy = false, notice, supported = true, onStart }: S0Props) {
  const [prior, setPrior] = useState<Prior | null>(null)
  const [sound, setSound] = useState<Sound>('idle')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    if (supported) player.preload(testUrl)
    return () => { alive.current = false; player.stop() }
  }, [player, testUrl, supported])

  if (!supported) {
    return (
      <section className="pt-s0">
        <p className="pt-warn" role="alert">{t(lang, 'pt.audio.unsupported')}</p>
      </section>
    )
  }

  const check = () => {
    setSound('playing')
    player.play(testUrl).then((r) => {
      if (!alive.current) return
      if (r === 'played') setSound('ask')
      else setSound(r) // failed, network; hidden — окно скрыли; cancelled — звук прервался (blur, нет жеста)
    })
  }

  const ready = prior !== null && sound === 'ok' && !busy
  return (
    <section className="pt-s0">
      {notice && <p className="pt-notice" role="status">{t(lang, notice)}</p>}
      <p className="pt-muted">{t(lang, 'pt.s0.about')}</p>
      <fieldset className="pt-priors">
        <legend>{t(lang, 'pt.s0.prior.q')}</legend>
        {PRIORS.map((p) => (
          <label key={p} className="pt-choice">
            <input type="radio" name="pt-prior" value={p} checked={prior === p} onChange={() => setPrior(p)} />
            <span>{t(lang, `pt.prior.${p}`)}</span>
          </label>
        ))}
      </fieldset>
      <div className="pt-sound">
        <p>{t(lang, 'pt.s0.sound.q')}</p>
        <div className="pt-actions">
          <button type="button" onClick={check} disabled={sound === 'playing'}>{t(lang, 'pt.s0.sound.play')}</button>
          {(sound === 'ask' || sound === 'notHeard') && (
            <>
              <button type="button" onClick={() => setSound('ok')}>{t(lang, 'pt.s0.sound.heard')}</button>
              <button type="button" onClick={() => setSound('notHeard')}>{t(lang, 'pt.s0.sound.notHeard')}</button>
            </>
          )}
        </div>
        <div aria-live="polite">
          {sound === 'ok' && <p className="pt-ok">{t(lang, 'pt.s0.sound.ok')}</p>}
          {sound === 'notHeard' && <p className="pt-warn">{t(lang, 'pt.s0.sound.hint')}</p>}
          {sound === 'failed' && <p className="pt-warn">{t(lang, 'pt.s0.sound.failed')}</p>}
          {sound === 'network' && <p className="pt-warn">{t(lang, 'pt.audio.network')}</p>}
          {sound === 'hidden' && <p className="pt-warn">{t(lang, 'pt.s0.sound.hidden')}</p>}
          {sound === 'cancelled' && <p className="pt-warn">{t(lang, 'pt.s0.sound.cancelled')}</p>}
        </div>
      </div>
      <div className="pt-actions">
        <button type="button" className="pt-primary" disabled={!ready} onClick={() => { if (ready) onStart(prior) }}>
          {t(lang, 'pt.s0.start')}
        </button>
        {!ready && !busy && <span className="pt-muted">{t(lang, prior === null ? 'pt.s0.needPrior' : 'pt.s0.needSound')}</span>}
      </div>
    </section>
  )
}
