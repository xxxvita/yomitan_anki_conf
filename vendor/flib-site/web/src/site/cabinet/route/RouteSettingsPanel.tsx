// RouteSettingsPanel.tsx — «Настройки маршрута» экрана дня (спека 2026-11-17
// §4.5, §4.12 элементы 8–9; план B10d; макет `cab-route.jsx:259-284`).
//
// Раскрывающийся блок, по умолчанию закрыт. После старта редактируются ТОЛЬКО
// «Минут в день» (15–540, шаг 5) и «Новых слов в день» (5–50, шаг 1) — диапазоны
// и шаги те же, что на экране старта и в приложении (раньше было 4 кнопки).
// Остальные ручки после старта шлюз держит закрытыми (409 params_locked), а BFF
// их в состоянии не отдаёт, поэтому показать их только для чтения нечем.
// Ползунок отправляет значение при отпускании (мышь, касание, клавиша, уход фокуса):
// `PUT /api/me/route/params` ровно одним полем. Сброс — ResetConfirm.
//
// ⚠️ Минуты демон замораживает после первого дня маршрута (inventory F1: значение
// запроса — только засев первой сборки, дальше главнее слепок), поэтому под
// «Минут в день» стоит пояснение «Изменение применится к новому маршруту».
import { useRef, useState } from 'react'
import { CabI } from '../cab-icons'
import { routeApi } from './route-api'
import { refreshSession } from '../../session'
import type { RouteParams } from './route-api'
import { ResetConfirm } from './ResetConfirm'
import { MINUTES_MAX, MINUTES_MIN, MINUTES_STEP, WORDS_MAX, WORDS_MIN, WORDS_STEP } from './route-settings'

export const SETTINGS_SAVED_TEXT = 'Применится к следующему дню маршрута'
export const MINUTES_FROZEN_TEXT = 'Изменение применится к новому маршруту'
export const SETTINGS_FAILED_TEXT = 'Не удалось сохранить настройку. Попробуйте позже'

type Field = 'daily_listening_budget_min' | 'daily_new_words'

const FIELDS: Array<{ f: Field; label: string; min: number; max: number; step: number; unit: string }> = [
  { f: 'daily_listening_budget_min', label: 'Минут в день', min: MINUTES_MIN, max: MINUTES_MAX, step: MINUTES_STEP, unit: ' мин' },
  { f: 'daily_new_words', label: 'Новых слов в день', min: WORDS_MIN, max: WORDS_MAX, step: WORDS_STEP, unit: ' сл/д' },
]

export interface SettingsProps {
  params: RouteParams
  resetBusy: boolean
  onReset: () => void
}

export function RouteSettingsPanel({ params, resetBusy, onReset }: SettingsProps) {
  // saved — последнее подтверждённое значение; draft — то, что показывает ползунок.
  const [saved, setSaved] = useState<Partial<Record<Field, number>>>({})
  const [draft, setDraft] = useState<Partial<Record<Field, number>>>({})
  const [pending, setPending] = useState<Field | null>(null)
  const [note, setNote] = useState<'saved' | 'failed' | null>(null)
  // Одно отпускание ползунка даёт несколько событий (pointerup + mouseup + blur): гонка state не должна слать PUT дважды.
  const busy = useRef(false)
  const current = (f: Field, min: number): number => saved[f] ?? params[f] ?? min
  const shown = (f: Field, min: number): number => draft[f] ?? current(f, min)

  const commit = async (f: Field, min: number) => {
    const v = draft[f]
    if (busy.current || v === undefined || v === current(f, min)) return
    busy.current = true
    setPending(f)
    setNote(null)
    const r = await routeApi.params({ [f]: v })
    busy.current = false
    setPending(null)
    if (r.ok) { setSaved(l => ({ ...l, [f]: v })); setNote('saved'); return }
    if (r.status === 401) void refreshSession().catch(() => undefined)
    setDraft(d => { const n = { ...d }; delete n[f]; return n })
    setNote('failed')
  }

  const row = (c: (typeof FIELDS)[number]) => {
    const v = shown(c.f, c.min)
    const release = () => void commit(c.f, c.min)
    return (
      <div className="set-row" key={c.f}>
        <label className="lbl" htmlFor={`rs-after-${c.f}`}>{c.label}</label>
        <div className="rs-after">
          <input id={`rs-after-${c.f}`} type="range" min={c.min} max={c.max} step={c.step} value={v}
            data-testid={`range-${c.f}`} disabled={pending !== null}
            onChange={e => setDraft(d => ({ ...d, [c.f]: Number(e.target.value) }))}
            onPointerUp={release} onMouseUp={release} onTouchEnd={release} onKeyUp={release} onBlur={release} />
          <span className="mono rs-after-v">{v}{c.unit}</span>
          {c.f === 'daily_listening_budget_min' && <span className="mute rs-after-n">{MINUTES_FROZEN_TEXT}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="block">
      <details className="settings" data-testid="route-settings">
        <summary><CabI.gear /><span className="mono" style={{ flex: 1 }}>Настройки маршрута</span><CabI.chev className="chev" /></summary>
        {FIELDS.map(row)}
        {note && (
          <div className="set-row" role="status">
            <span />
            <span className={note === 'saved' ? 'saved' : 'mute'}>{note === 'saved' ? SETTINGS_SAVED_TEXT : SETTINGS_FAILED_TEXT}</span>
          </div>
        )}
        <div className="set-row">
          <span className="lbl">Сбросить маршрут</span>
          <ResetConfirm busy={resetBusy} onConfirm={onReset} />
        </div>
      </details>
    </div>
  )
}
