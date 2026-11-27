// AudioWidgets.tsx — общие для всех экранов теста куски: прогресс-пилюли
// (Tprog) + единый аудио-компонент (AudioOrb/RepeatBtn/TtsAlert).
//
// Порт temp/flib/test.jsx:5-68, только вместо самодельного useAudioItem
// (setTimeout-эмуляция) — реальный useTts.ts (POST /api/tts). Состояния
// кнопки идентичны DESIGN_SPEC.md §0.3: idle→loading→playing→ready, плюс
// error с мягкой плашкой (§8 таблица ошибок).
import type { UseTtsResult } from './useTts'

export const TEST_STEPS = ['Старт', 'Анкета', 'Словарь', 'Диктант', 'Повтор', 'Итог']

export type TestStepIndex = 0 | 1 | 2 | 3 | 4 | 5

interface TprogProps {
  idx: TestStepIndex
}

// DESIGN_SPEC.md §0.2: клик по пройденной пилюле НЕ предусмотрен — назад
// по шагам нельзя (портит адаптивную оценку). Пилюли декоративны (span, не
// button).
export function Tprog({ idx }: TprogProps) {
  return (
    <div className="tprog">
      {TEST_STEPS.map((s, i) => (
        <span key={s} className={`pill ${i === idx ? 'active' : i < idx ? 'done' : ''}`}>
          {i < idx ? '✓ ' : ''}{s}
        </span>
      ))}
    </div>
  )
}

interface AudioOrbProps {
  tts: UseTtsResult
  big?: boolean
}

export function AudioOrb({ tts, big }: AudioOrbProps) {
  const cls = tts.state === 'error' ? 'idle' : tts.state
  return (
    <div
      className={`aud-orb ${cls}`}
      onClick={() => tts.state === 'ready' && tts.replay()}
      role="button"
      aria-label="аудио"
      aria-live="polite"
      style={big ? {} : { width: 96, height: 96 }}
    >
      <span className="ic">{tts.state === 'playing' ? <i /> : null}</span>
    </div>
  )
}

interface RepeatBtnProps {
  tts: UseTtsResult
}

export function RepeatBtn({ tts }: RepeatBtnProps) {
  const disabled = tts.repeatsLeft <= 0 || tts.state === 'loading' || tts.state === 'playing'
  return (
    <button type="button" className="repeat-btn" disabled={disabled} onClick={tts.replay}>
      🔊 Повторить {tts.repeatsLeft <= 0 && '· повторов больше нет'}
    </button>
  )
}

interface TtsAlertProps {
  tts: UseTtsResult
}

// DESIGN_SPEC.md §8: TTS-ошибка — пользователь видит мягко, восстановление
// «Повторить» / авто-fallback. Клик здесь переключает на браузерный голос
// (useTts.retry), не повторяет тот же сетевой запрос — тексту, скорее
// всего, снова не ответит тот же бэк/сеть.
export function TtsAlert({ tts }: TtsAlertProps) {
  if (tts.state !== 'error') return null
  return (
    <div className="soft-alert" role="alert" aria-live="assertive">
      <span className="ai">⚠</span>
      <span>Звук не подгрузился. <a onClick={tts.retry} style={{ cursor: 'pointer' }}>Повторить</a> — включим запасной голос.</span>
    </div>
  )
}
