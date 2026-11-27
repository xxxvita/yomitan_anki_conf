// StartScreen.tsx — экран 0: старт (DESIGN_SPEC.md §1, temp/flib/test.jsx
// StartScreen).
//
// «Начать тест» активна после успешного воспроизведения ИЛИ по чекбоксу
// «звук работает» (задача Э4 п.3): DESIGN_SPEC говорит "кнопка «Начать»
// доступна всегда (звук можно проверить и позже)" — здесь чуть строже по
// прямому требованию задачи, чекбокс — явный escape hatch для того, у кого
// звук технически не подгружается, но кто хочет пройти тест (например TTS
// недоступен, а fallback-голоса в браузере тоже нет).
import { useState } from 'react'
import { useTts } from './useTts'
import { TtsAlert } from './AudioWidgets'

// Короткая фраза для проверки звука — фиксированный текст, не входит в
// стимулы теста (не тратит TTS-кэш стимулов теста, кэшируется так же на бэке).
const SOUND_CHECK_TEXT = 'Can you hear me? This is a quick sound check.'

const STEPS: [string, string][] = [
  ['Анкета', '≈1 мин'],
  ['Словарь на слух', '≈2 мин'],
  ['Диктант', '≈2 мин'],
  ['Повтор', '≈1 мин'],
  ['Итог + словарь', ''],
]

interface StartScreenProps {
  onNext: () => void
}

export function StartScreen({ onNext }: StartScreenProps) {
  const tts = useTts(SOUND_CHECK_TEXT, { manual: true })
  const [soundOkCheckbox, setSoundOkCheckbox] = useState(false)
  const soundConfirmed = tts.state === 'ready'
  const canStart = soundConfirmed || soundOkCheckbox

  function statusLabel(): string {
    if (soundConfirmed) return '✅ Звук работает'
    if (tts.state === 'loading') return 'Загружаю…'
    if (tts.state === 'playing') return 'Играю…'
    if (tts.state === 'error') return 'Не получилось — см. подсказку ниже'
    return 'убедитесь, что слышите'
  }

  return (
    <div className="tcard center">
      <div className="eyebrow" style={{ marginBottom: 14 }}>Быстрый тест · 5–7 минут</div>
      <h1>Оценка Вашего английского на слух</h1>
      <p className="instr">
        Мы озвучиваем слова и фразы — слушайте и отвечайте. Где нужно — печатаете, что расслышали.
        В конце получите свой словарь и маршрут.
      </p>
      <ol className="start-list">
        {STEPS.map(([t, d], i) => (
          <li key={i}>
            <span className="num">{i + 1}</span>
            <span>{t}</span>
            {d && <span className="d">{d}</span>}
          </li>
        ))}
      </ol>

      <div className="sound-check">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={tts.play}
          disabled={tts.state === 'playing' || tts.state === 'loading'}
        >
          🔊 {tts.state === 'playing' || tts.state === 'loading' ? 'Играю…' : 'Проверить звук'}
        </button>
        <span className={`sound-status ${soundConfirmed ? 'ok' : ''}`}>{statusLabel()}</span>
      </div>
      <TtsAlert tts={tts} />

      <label className="sound-check-fallback">
        <input
          type="checkbox"
          checked={soundOkCheckbox}
          onChange={e => setSoundOkCheckbox(e.target.checked)}
        />
        Звук работает (пропустить проверку)
      </label>

      <div className="headphones-hint">🎧 лучше проходить в наушниках</div>
      <div className="tcard-actions">
        <button type="button" className="btn btn-amber btn-lg" disabled={!canStart} onClick={onNext}>
          Начать тест →
        </button>
      </div>
    </div>
  )
}
