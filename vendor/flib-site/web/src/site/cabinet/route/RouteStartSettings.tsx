// RouteStartSettings.tsx — «Настройки маршрута» на экране старта, ПЕРЕД «Начать
// маршрут» (решение владельца 2026-11-21: те же ручки, что в приложении).
// Чипы пресетов видны всегда, «Тонкая настройка» свёрнута. Подписи, подсказки и
// порядок — из приложения (RouteSettingsSection.tsx, ru.ts), обращение «Вы».
// Модель и тексты ручек — route-settings.ts; здесь только вид.
import { useState, type ReactNode } from 'react'
import { hhmmOfMinutes, minutesOfHHMM } from './learning-day'
import {
  applyPreset, COVERAGE_MAX, COVERAGE_MIN, COVERAGE_STEP, COVERAGE_WARN_ABOVE, GATE_MAX, GATE_MIN, GATE_STEP,
  KIDS_MAX, KIDS_MIN, KIDS_PROFILE_HINT, KIDS_STEP, MINUTES_MAX, MINUTES_MIN, MINUTES_STEP, PRESET_LABELS,
  ROUTE_PRESETS, ROUTE_TEMPO_OVER_GOAL, setField, setKids, setTempo, TEMPO_MAX, TEMPO_MIN, TEMPO_STEP,
  WORDS_MAX, WORDS_MIN, WORDS_STEP, type PresetKey, type RouteSettings,
} from './route-settings'

export const SETTINGS_TEXT = {
  title: 'Настройки маршрута',
  fine: 'Тонкая настройка',
  unknownShare: 'Незнакомого в уроке',
  poleMoreWords: 'понятнее',
  poleHarder: 'труднее',
  goalCoverage: 'Насколько закрываем цель',
  coverageWarn: 'Последние проценты цели — самые редкие слова: маршрут ради них станет заметно длиннее',
  minutes: 'Минут в день',
  words: 'Новых слов в день',
  dayTransition: 'Смена учебного дня',
  kids: 'Детский уровень',
  kidsAllowed: 'можно детское',
  kidsStrict: 'только взрослая речь',
  byProfile: 'по профилю',
  byProfileReset: 'вернуть по профилю',
  tempo: 'Речь быстрее цели',
  hint: {
    unknownShare: 'Какую часть урока можно не понимать. Чем меньше — тем понятнее видео, но тем больше слов придётся выучить карточками до него. Чем больше — тем быстрее Вы попадаете в живую речь, но тем труднее слушать.',
    goalCoverage: 'Какую часть слов Вашей цели маршрут доведёт до знакомых. После 90% идут редкие слова: в обычном сериале их мало, и 90% достаточно. В специальном материале — научном, юридическом — редкие слова и есть суть, тогда имеет смысл закрывать почти всё. Чем выше, тем длиннее маршрут.',
    minutes: 'Сколько минут в день Вы готовы слушать. Это число и задаёт, что считается днём: ролики набираются, пока не заполнят Ваш бюджет.',
    words: 'Сколько новых слов в день Вы готовы брать. Это ориентир темпа, а не жёсткий потолок: подбор может дать чуть больше, если иначе пришлось бы разорвать хороший урок.',
    dayTransition: 'В какой час у Вас начинается новый учебный день. Всё, что Вы прошли до этого часа, попадёт в предыдущий день календаря. Поставьте 04:00, если занимаетесь допоздна: тогда ролик в час ночи останется во вчерашнем дне, а не откроет новый.',
    kids: 'Насколько взрослая речь Вам нужна. Слева допускаются уроки для детей, справа остаётся только взрослая речь. Пока Вы не трогали ползунок, берётся значение из настроек сервиса — поэтому там написано «по профилю».',
    tempo: 'На сколько слов в минуту речь может быть быстрее Вашей цели. Ноль — как в самой цели. Поднимите, если хотите приучать себя к более быстрой речи, чем в выбранном фильме.',
  },
} as const

const PRESET_KEYS: PresetKey[] = ['comfort', 'balanced', 'fast']

export const presetCaption = (p: PresetKey): string => `${ROUTE_PRESETS[p].minutes} мин в день · ${ROUTE_PRESETS[p].words} новых слов`

interface RowProps { id: string; label: string; hint: string; value: ReactNode; children: ReactNode; poles?: [string, string] }

// Row — подпись, «?» с подсказкой в потоке (не всплывающая: на телефоне наведения нет),
// ползунок на всю ширину, значение справа.
function Row({ id, label, hint, value, children, poles }: RowProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rs-row">
      <div className="rs-top">
        <label className="rs-lbl" htmlFor={id}>{label}</label>
        <button type="button" className="rs-q" aria-label={`Подсказка: ${label}`} aria-expanded={open} aria-controls={id + '-hint'}
          onClick={() => setOpen(o => !o)}>?</button>
        <span className="rs-val mono">{value}</span>
      </div>
      <div className="rs-ctl">
        {poles && <span className="rs-pole">{poles[0]}</span>}
        {children}
        {poles && <span className="rs-pole">{poles[1]}</span>}
      </div>
      {open && <p className="rs-hint" id={id + '-hint'}>{hint}</p>}
    </div>
  )
}

export interface RouteStartSettingsProps {
  value: RouteSettings
  onChange: (next: RouteSettings) => void
  dayMin: number
  onDayMin: (minutes: number) => void
}

export function RouteStartSettings({ value: s, onChange, dayMin, onDayMin }: RouteStartSettingsProps) {
  const T = SETTINGS_TEXT
  const num = (fn: (v: number) => RouteSettings) => (e: { target: { value: string } }) => onChange(fn(Number(e.target.value)))
  return (
    <section className="st-sec rs" data-testid="route-start-settings" aria-labelledby="rs-title">
      <div className="st-h"><h2 id="rs-title">{T.title}</h2></div>
      <div className="rs-presets" role="group" aria-label={T.title}>
        {PRESET_KEYS.map(p => {
          const on = s.presetId === p
          return (
            <button key={p} type="button" className={'rs-preset' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange(applyPreset(s, p))}>
              <b>{PRESET_LABELS[p]}</b>
              <span>{presetCaption(p)}</span>
            </button>
          )
        })}
      </div>

      <details className="rs-fine">
        <summary>{T.fine}</summary>

        <Row id="rs-gate" label={T.unknownShare} hint={T.hint.unknownShare} poles={[T.poleMoreWords, T.poleHarder]} value={`${s.gatePct}%`}>
          <input id="rs-gate" type="range" className="rs-range" min={GATE_MIN} max={GATE_MAX} step={GATE_STEP} value={s.gatePct}
            onChange={num(v => setField(s, 'gatePct', v))} />
        </Row>

        <Row id="rs-cov" label={T.goalCoverage} hint={T.hint.goalCoverage} value={`${s.coveragePct}%`}>
          <input id="rs-cov" type="range" className="rs-range" min={COVERAGE_MIN} max={COVERAGE_MAX} step={COVERAGE_STEP} value={s.coveragePct}
            onChange={num(v => setField(s, 'coveragePct', v))} />
        </Row>
        {/* Место под предупреждение занято всегда: иначе строка сдвигает ползунок под курсором. */}
        <div className="rs-warn" role="alert">{s.coveragePct > COVERAGE_WARN_ABOVE ? T.coverageWarn : ''}</div>

        <Row id="rs-min" label={T.minutes} hint={T.hint.minutes} value={`${s.minutes} мин`}>
          <input id="rs-min" type="range" className="rs-range" min={MINUTES_MIN} max={MINUTES_MAX} step={MINUTES_STEP} value={s.minutes}
            onChange={num(v => setField(s, 'minutes', v))} />
        </Row>

        <Row id="rs-words" label={T.words} hint={T.hint.words} value={`${s.words} сл/д`}>
          <input id="rs-words" type="range" className="rs-range" min={WORDS_MIN} max={WORDS_MAX} step={WORDS_STEP} value={s.words}
            onChange={num(v => setField(s, 'words', v))} />
        </Row>

        <Row id="rs-day" label={T.dayTransition} hint={T.hint.dayTransition} value="">
          <input id="rs-day" type="time" className="rs-time" value={hhmmOfMinutes(dayMin)}
            onChange={e => {
              // Пустое поле (человек стирает и набирает заново) настройку не трогает.
              const m = minutesOfHHMM(e.target.value)
              if (m !== null) onDayMin(m)
            }} />
        </Row>

        <Row id="rs-kids" label={T.kids} hint={T.hint.kids} poles={[T.kidsAllowed, T.kidsStrict]}
          value={s.kidsPct === null ? T.byProfile : `${s.kidsPct} из 70`}>
          <input id="rs-kids" type="range" className="rs-range" min={KIDS_MIN} max={KIDS_MAX} step={KIDS_STEP}
            value={s.kidsPct ?? KIDS_PROFILE_HINT}
            aria-valuetext={s.kidsPct === null ? T.byProfile : `${s.kidsPct} из 70`}
            onChange={num(v => setKids(s, v))} />
        </Row>
        {s.kidsPct !== null && (
          <button type="button" className="btn rs-reset" onClick={() => onChange(setKids(s, null))}>{T.byProfileReset}</button>
        )}

        {ROUTE_TEMPO_OVER_GOAL && (
          <Row id="rs-tempo" label={T.tempo} hint={T.hint.tempo} value={`+${s.tempo} сл/мин`}>
            <input id="rs-tempo" type="range" className="rs-range" min={TEMPO_MIN} max={TEMPO_MAX} step={TEMPO_STEP} value={s.tempo}
              onChange={num(v => setTempo(s, v))} />
          </Row>
        )}
      </details>
    </section>
  )
}
