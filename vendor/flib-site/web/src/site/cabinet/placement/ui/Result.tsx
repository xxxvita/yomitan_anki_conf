// S5 «Результат» (спека §5.3): уровень, ≈ словарь и ci90, флаги словами (yeasayer/careless — неточный,
// no_audio — звук не играл, floor — начнём с начала), засчитанные слова по убыванию p (≤ 8 000 —
// список строится только по «Показать»), мягкая подсказка R19 и «Пройти заново» всегда (R19).
// Сайт: stale — результат старее принятого на другом устройстве; extra — блок «Маршрут» страницы.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FLAG_CARELESS, FLAG_FLOOR, FLAG_NO_AUDIO, FLAG_YEASAYER } from '../engine/session'
import { t, wordsN, type Lang } from '../i18n'
import type { RunOutcome } from '../store'
import { fmtNum } from './format'

export function flagNotes(flags: readonly string[]): string[] {
  const out: string[] = []
  if (flags.includes(FLAG_YEASAYER) || flags.includes(FLAG_CARELESS)) out.push('pt.flag.inexact')
  if (flags.includes(FLAG_NO_AUDIO)) out.push('pt.flag.no_audio')
  if (flags.includes(FLAG_FLOOR)) out.push('pt.flag.floor')
  return out
}

export function Result({ lang, outcome, onRetake, stale = false, extra }: {
  lang: Lang; outcome: RunOutcome; onRetake: () => void; stale?: boolean; extra?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => { head.current?.focus() }, []) // результат — фокус на заголовок
  const words = useMemo(() => [...outcome.words].sort((a, b) => b.p - a.p || a.rank - b.rank), [outcome])
  return (
    <section className="pt-result">
      <p className="pt-eyebrow">{t(lang, 'pt.result.title')}</p>
      <h2 className="pt-level" tabIndex={-1} ref={head}>{t(lang, 'pt.result.level', { level: outcome.level })}</h2>
      <p>
        {t(lang, 'pt.result.vocab', { n: fmtNum(lang, outcome.vocab_size), words: wordsN(lang, outcome.vocab_size) })}
        {' — '}
        <span className="pt-muted">{t(lang, 'pt.result.ci', { lo: fmtNum(lang, outcome.ci90[0]), hi: fmtNum(lang, outcome.ci90[1]) })}</span>
      </p>
      {flagNotes(outcome.flags).map((k) => <p key={k} className="pt-warn">{t(lang, k)}</p>)}
      {stale && <p className="pt-notice" role="status">{t(lang, 'pt.result.stale')}</p>}
      {extra}
      <p className="pt-hint">{t(lang, 'pt.result.hint')}</p>
      <div className="pt-actions">
        <button type="button" className={extra ? undefined : 'pt-primary'} onClick={onRetake}>{t(lang, 'pt.result.retake')}</button>
      </div>
      <div className="pt-words">
        <span>{t(lang, 'pt.result.words', { n: fmtNum(lang, words.length) })}</span>{' '}
        {words.length > 0 && (
          <button type="button" className="pt-link" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
            {t(lang, open ? 'pt.result.words.hide' : 'pt.result.words.show')}
          </button>
        )}
        {open && <ul className="pt-wordlist">{words.map((w) => <li key={w.lemma}>{w.lemma}</li>)}</ul>}
      </div>
    </section>
  )
}
