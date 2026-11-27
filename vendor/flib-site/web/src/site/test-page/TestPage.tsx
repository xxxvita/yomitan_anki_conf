// TestPage.tsx — /test, адаптивный онбординг-тест (ТЗ-1..6, Э4).
//
// FSM: start → survey → vocab → dictation → ei → result. Клип-верификация
// (temp/flib/test.jsx ClipVerifyScreen) в v1 ПРОПУЩЕНА — она требует
// реальных аудио-клипов из целевого контента (владелец: план,
// docs/plan-2026-07-13-design-transfer.md — эта задача их не заводит).
// synthesize() зовётся без пятого аргумента clipResults, см. TODO в
// handleEiDone ниже.
//
// Состояние теста — React-стейт этого компонента, НЕ localStorage/
// sessionStorage. Осознанно: методика (DESIGN_SPEC.md §9 «Повторное
// прохождение» — "назад по шагам — НЕТ, адаптивная оценка не должна
// редактироваться постфактум") и time-boxed формат (5-7 мин) вместе значат,
// что прерванный тест ДОЛЖЕН начинаться заново, а не "продолжаться с того
// места" — персистентность прогресса была бы противоречием методике
// (сохранённый answered-стейт AuralEngine, к которому вернулись через
// полчаса, не то же самое измерение, что непрерывный прогон).
//
// Выход из теста: клик по BrandMark ИЛИ «✕ выйти» открывает confirm-модалку
// (кроме экранов start/result, где прогресса нет/уже финал) — методика не
// допускает кнопки «назад» между этапами теста вообще (ни один экран здесь
// не рендерит "← предыдущий шаг"), только полный выход с подтверждением
// или переход вперёд.
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { BrandMark } from '../BrandMark'
import { Tprog, type TestStepIndex } from './AudioWidgets'
import { StartScreen } from './StartScreen'
import { SurveyScreen } from './SurveyScreen'
import { VocabScreen } from './VocabScreen'
import { DictationScreen } from './DictationScreen'
import { EiScreen } from './EiScreen'
import { ResultScreen } from './ResultScreen'
import {
  priorFromSurvey, synthesize,
  type Prior, type VocabResult, type DecodingResult, type EiResult, type SynthResult, type SurveyAnswers, type TargetProfile,
} from './math'
import './test.css'

type TestStep = 'start' | 'survey' | 'vocab' | 'dictation' | 'ei' | 'result'

const STEP_INDEX: Record<TestStep, TestStepIndex> = {
  start: 0, survey: 1, vocab: 2, dictation: 3, ei: 4, result: 5,
}

export function TestPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<TestStep>('start')
  const [prior, setPrior] = useState<Prior | null>(null)
  const [target, setTarget] = useState<TargetProfile | undefined>(undefined)
  const [vocabResult, setVocabResult] = useState<VocabResult | null>(null)
  const [decResult, setDecResult] = useState<DecodingResult | null>(null)
  const [eiResult, setEiResult] = useState<EiResult | null>(null)
  const [synthResult, setSynthResult] = useState<SynthResult | null>(null)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)

  const progressProtected = step !== 'start' && step !== 'result'

  function requestExit() {
    if (progressProtected) {
      setExitConfirmOpen(true)
    } else {
      navigate('/')
    }
  }

  function handleBrandClick(e: React.MouseEvent) {
    if (progressProtected) {
      e.preventDefault()
      setExitConfirmOpen(true)
    }
  }

  function confirmExit() {
    setExitConfirmOpen(false)
    navigate('/')
  }

  function handleRestart() {
    setStep('start')
    setPrior(null)
    setTarget(undefined)
    setVocabResult(null)
    setDecResult(null)
    setEiResult(null)
    setSynthResult(null)
  }

  function handleSurveyNext(answers: SurveyAnswers, chosenTarget: TargetProfile | undefined) {
    setPrior(priorFromSurvey(answers))
    setTarget(chosenTarget)
    setStep('vocab')
  }

  function handleVocabDone(result: VocabResult) {
    setVocabResult(result)
    setStep('dictation')
  }

  function handleDictationDone(result: DecodingResult) {
    setDecResult(result)
    setStep('ei')
  }

  function handleEiDone(result: EiResult) {
    setEiResult(result)
    if (prior && vocabResult && decResult) {
      // TODO(clip-verify): v1 пропускает клип-верификацию (temp/flib/test.jsx
      // ClipVerifyScreen) — нужны реальные аудио-клипы целевого контента,
      // их источника в этом этапе нет (план Э4, задача явно требует
      // пропустить с TODO). synthesize() зовётся с clipResults=undefined
      // (5-й позиционный аргумент) — target (анкетная цель, 6-й аргумент)
      // передаётся уже сейчас, это НЕ клип-верификация, а просто опциональный
      // параметр той же функции. Когда клипы появятся: вставить экран между
      // 'ei' и 'result' в этом FSM и передать его результат в clipResults.
      setSynthResult(synthesize(prior, vocabResult, decResult, result, undefined, target))
    }
    setStep('result')
  }

  function handleRouteCreated() {
    navigate('/route')
  }

  return (
    <div className="site">
      <div className="view">
        <div className="page page-narrow">
          <div className="test-topbar">
            <span onClickCapture={handleBrandClick}><BrandMark quiet /></span>
            <button type="button" className="test-exit-btn" onClick={requestExit}>✕ выйти</button>
          </div>

          <Tprog idx={STEP_INDEX[step]} />

          {step === 'start' && <StartScreen onNext={() => setStep('survey')} />}
          {step === 'survey' && <SurveyScreen onNext={handleSurveyNext} />}
          {step === 'vocab' && prior && <VocabScreen prior={prior} onDone={handleVocabDone} />}
          {step === 'dictation' && vocabResult && <DictationScreen vocabResult={vocabResult} onDone={handleDictationDone} />}
          {step === 'ei' && vocabResult && <EiScreen vocabResult={vocabResult} onDone={handleEiDone} />}
          {step === 'result' && vocabResult && synthResult && (
            <ResultScreen
              vocabResult={vocabResult}
              synthResult={synthResult}
              eiResult={eiResult}
              onRestart={handleRestart}
              onRouteCreated={handleRouteCreated}
            />
          )}
        </div>
      </div>

      {exitConfirmOpen && (
        <div className="rs-overlay" onClick={() => setExitConfirmOpen(false)}>
          <div className="rs-modal test-exit-modal" onClick={e => e.stopPropagation()}>
            <div className="rs-head">
              <div>
                <div className="eyebrow">Выйти из теста?</div>
                <h2>Прогресс пропадёт</h2>
              </div>
              <button type="button" className="rs-x" onClick={() => setExitConfirmOpen(false)} aria-label="закрыть">✕</button>
            </div>
            <div className="rs-body">
              Тест не сохраняет промежуточный прогресс — если выйдете сейчас, при следующем заходе придётся начать заново.
            </div>
            <div className="rs-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setExitConfirmOpen(false)}>Остаться</button>
              <button type="button" className="btn btn-amber" onClick={confirmExit}>Выйти</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
