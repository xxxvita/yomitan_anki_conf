// SurveyScreen.tsx — экран 1: анкета (ТЗ-2, DESIGN_SPEC.md §2,
// temp/flib/test.jsx SurveyScreen).
//
// Все поля имеют дефолт — «Дальше» доступна сразу, пропуск полей допустим
// (DESIGN_SPEC §2 «Состояния/ошибки»). Дропдауны/чипы хранят ИНДЕКС выбора
// (не сам enum) — так и русский лейбл, и math-значение (survey-data.ts
// values[]) читаются из одного и того же индекса без отдельной обратной
// таблицы поиска.
import { useState } from 'react'
import { SURVEY_FIELDS, SURVEY_EXPOSURE_OPTIONS, SURVEY_EXPOSURE_VALUES, SURVEY_SELF, SURVEY_GOALS } from './survey-data'
import { TARGET_PRESETS, type SurveyAnswers, type TargetProfile } from './math'

// SURVEY_GOALS (тексты дизайнера) не совпадает 1:1 с TARGET_PRESETS (только
// 2 пресета в математике — easy='Friends'/hard='The Wire', tz2 §7 план: анкета
// — просто ЛЁГКАЯ прикидка). Мапим "Friends" на easy-профиль дословно;
// любую другую выбранную цель — на hard (более консервативная оценка
// покрытия, чем выдумывать долю лемм для контента, которого нет в TARGET_PRESETS).
// Ничего не выбрано → undefined (synthesize() не строит "Под цель"-пресет).
function targetForGoals(goals: string[]): TargetProfile | undefined {
  if (goals.length === 0) return undefined
  if (goals.includes('Friends')) return TARGET_PRESETS.easy
  return TARGET_PRESETS.hard
}

interface SurveyScreenProps {
  onNext: (answers: SurveyAnswers, target: TargetProfile | undefined) => void
}

export function SurveyScreen({ onNext }: SurveyScreenProps) {
  const [examIdx, setExamIdx] = useState(0)
  const [yearsIdx, setYearsIdx] = useState(0)
  const [brkIdx, setBrkIdx] = useState(0)
  const [envIdx, setEnvIdx] = useState(0)
  const [exposure, setExposure] = useState<string[]>([])
  const [self, setSelf] = useState<string[]>([])
  const [goals, setGoals] = useState<string[]>([])

  function toggle(arr: string[], set: (v: string[]) => void, v: string) {
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])
  }

  function handleNext() {
    const domains = exposure
      .map(label => SURVEY_EXPOSURE_OPTIONS.indexOf(label))
      .filter(i => i >= 0)
      .map(i => SURVEY_EXPOSURE_VALUES[i])
    const answers: SurveyAnswers = {
      exam: SURVEY_FIELDS.exam.values[examIdx],
      years: SURVEY_FIELDS.years.values[yearsIdx],
      brk: SURVEY_FIELDS.brk.values[brkIdx],
      env: SURVEY_FIELDS.env.values[envIdx],
      domains,
      cando: self.length / SURVEY_SELF.length,
    }
    onNext(answers, targetForGoals(goals))
  }

  return (
    <div className="tcard">
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Шаг 1 · анкета</div>
        <h2 style={{ fontSize: 26 }}>Пара штрихов о Вас</h2>
        <p className="instr">Это стартовая прикидка — тест дальше уточнит. Можно пропускать поля.</p>
      </div>

      <div className="form-field">
        <label className="flbl" htmlFor="survey-exam">{SURVEY_FIELDS.exam.label}</label>
        <select id="survey-exam" className="tselect" value={examIdx} onChange={e => setExamIdx(Number(e.target.value))}>
          {SURVEY_FIELDS.exam.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label className="flbl" htmlFor="survey-years">{SURVEY_FIELDS.years.label}</label>
        <select id="survey-years" className="tselect" value={yearsIdx} onChange={e => setYearsIdx(Number(e.target.value))}>
          {SURVEY_FIELDS.years.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label className="flbl" htmlFor="survey-brk">{SURVEY_FIELDS.brk.label}</label>
        <select id="survey-brk" className="tselect" value={brkIdx} onChange={e => setBrkIdx(Number(e.target.value))}>
          {SURVEY_FIELDS.brk.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      </div>

      <div className="form-field">
        <label className="flbl">Где Вы сталкиваетесь с английским?</label>
        <div className="check-row">
          {SURVEY_EXPOSURE_OPTIONS.map(o => (
            <button key={o} type="button" className={`check-chip ${exposure.includes(o) ? 'on' : ''}`} onClick={() => toggle(exposure, setExposure, o)}>
              <span className="box">{exposure.includes(o) ? '✓' : ''}</span>{o}
            </button>
          ))}
        </div>
        <div className="hint">выберите 2–3 основных — так оценка слуха точнее</div>
      </div>

      <div className="form-field">
        <label className="flbl">Что из этого про Вас?</label>
        <div className="check-list">
          {SURVEY_SELF.map(o => (
            <button key={o} type="button" className={`check-chip ${self.includes(o) ? 'on' : ''}`} onClick={() => toggle(self, setSelf, o)}>
              <span className="box">{self.includes(o) ? '✓' : ''}</span>{o}
            </button>
          ))}
        </div>
      </div>

      <div className="form-field">
        <label className="flbl" htmlFor="survey-env">{SURVEY_FIELDS.env.label}</label>
        <select id="survey-env" className="tselect" value={envIdx} onChange={e => setEnvIdx(Number(e.target.value))}>
          {SURVEY_FIELDS.env.options.map((o, i) => <option key={o} value={i}>{o}</option>)}
        </select>
      </div>

      <div className="form-field">
        <label className="flbl">Какой сериал/фильм хотите понимать без субтитров?</label>
        <div className="check-row">
          {SURVEY_GOALS.map(o => (
            <button key={o} type="button" className={`check-chip ${goals.includes(o) ? 'on' : ''}`} onClick={() => toggle(goals, setGoals, o)}>
              <span className="box">{goals.includes(o) ? '✓' : ''}</span>{o}
            </button>
          ))}
        </div>
        <div className="hint">можно выбрать несколько целей</div>
      </div>

      <div className="tcard-actions">
        <button type="button" className="btn btn-amber btn-lg" onClick={handleNext}>Дальше →</button>
        <div className="sub-note" style={{ textAlign: 'center' }}>
          Это стартовая прикидка. Тест дальше уточнит и сдвинет её не больше чем на одну ступень.
        </div>
      </div>
    </div>
  )
}
