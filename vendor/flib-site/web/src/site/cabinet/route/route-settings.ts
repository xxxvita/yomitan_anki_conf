// route-settings.ts — «Настройки маршрута» экрана старта: те же ручки, что в
// приложении (anki_conf CoursesPanel/route/route-settings-store.ts), чистая
// модель без React. Подписи, пресеты, диапазоны и шаги — копия приложения;
// инвентарь — .local/share/flib/route-params/2026-11-21-app-route-settings-inventory.md.
//
// Что НЕ переносится: источники (маршрут пользователя на сайте — только YouTube,
// решение владельца о правовой стороне; в тело уходит sources=["youtube"] на стороне
// BFF) и «Мой уровень» CEFR (в маршрут не идёт, инвентарь F2).
//
// Значения хранятся в ЦЕЛЫХ процентах (gatePct 15, coveragePct 95, kidsPct 55):
// шаг ползунка без накопления ошибки float, в долю (0.15) переводит только
// `settingsBody` — одной операцией /100.

/** «Речь быстрее цели» скрыта: демон отказывает при значении > 0, если в профиле
 * default@1 выключен коридор темпа (inventory F6 — на проде НЕ ПРОВЕРЕНО). BFF
 * держит ту же ручку выключенной (cabinetTempoOverGoalEnabled). */
export const ROUTE_TEMPO_OVER_GOAL = false

export type PresetId = 'comfort' | 'balanced' | 'fast' | 'custom'
export type PresetKey = Exclude<PresetId, 'custom'>

export const GATE_MIN = 5
export const GATE_MAX = 50
export const GATE_STEP = 5
export const COVERAGE_MIN = 40
export const COVERAGE_MAX = 100
export const COVERAGE_STEP = 5
/** Выше этого значения показывается предупреждение (при шаге 5 это только 100 %). */
export const COVERAGE_WARN_ABOVE = 99
export const MINUTES_MIN = 15
export const MINUTES_MAX = 540
export const MINUTES_STEP = 5
export const WORDS_MIN = 5
export const WORDS_MAX = 50
export const WORDS_STEP = 1
export const KIDS_MIN = 0
export const KIDS_MAX = 70
export const KIDS_STEP = 1
/** Показ на слайдере, пока «по профилю» (само значение не уходит). */
export const KIDS_PROFILE_HINT = 55
export const TEMPO_MIN = 0
export const TEMPO_MAX = 100
export const TEMPO_STEP = 5

export interface PresetValues { gatePct: number; coveragePct: number; minutes: number; words: number }

export const ROUTE_PRESETS: Record<PresetKey, PresetValues> = {
  comfort: { gatePct: 10, coveragePct: 95, minutes: 60, words: 15 },
  balanced: { gatePct: 15, coveragePct: 95, minutes: 120, words: 20 },
  fast: { gatePct: 30, coveragePct: 95, minutes: 180, words: 30 },
}

export const PRESET_LABELS: Record<PresetKey, string> = {
  comfort: 'Комфортно',
  balanced: 'Сбалансированно',
  fast: 'Быстрее к цели',
}

export interface RouteSettings extends PresetValues {
  presetId: PresetId
  /** null — «по профилю»: ключ min_r_clean_override не уходит. */
  kidsPct: number | null
  tempo: number
}

export const DEFAULT_SETTINGS: RouteSettings = { presetId: 'balanced', ...ROUTE_PRESETS.balanced, kidsPct: null, tempo: 0 }

const clamp = (v: number, lo: number, hi: number, step: number): number => {
  if (!Number.isFinite(v)) return lo
  const snapped = lo + Math.round((v - lo) / step) * step
  return Math.min(hi, Math.max(lo, snapped))
}
export const clampGate = (v: number): number => clamp(v, GATE_MIN, GATE_MAX, GATE_STEP)
export const clampCoverage = (v: number): number => clamp(v, COVERAGE_MIN, COVERAGE_MAX, COVERAGE_STEP)
export const clampMinutes = (v: number): number => clamp(v, MINUTES_MIN, MINUTES_MAX, MINUTES_STEP)
export const clampWords = (v: number): number => clamp(v, WORDS_MIN, WORDS_MAX, WORDS_STEP)
export const clampKids = (v: number): number => clamp(v, KIDS_MIN, KIDS_MAX, KIDS_STEP)
export const clampTempo = (v: number): number => clamp(v, TEMPO_MIN, TEMPO_MAX, TEMPO_STEP)

/** Выбор пресета ставит ползунки 2–5; детский уровень и темп не трогает. */
export function applyPreset(s: RouteSettings, id: PresetKey): RouteSettings {
  return { ...s, presetId: id, ...ROUTE_PRESETS[id] }
}

/** Движение ползунка 2–5 снимает пресет (как в приложении: presetId='custom'). */
export function setField(s: RouteSettings, field: keyof PresetValues, v: number): RouteSettings {
  const clamped = field === 'gatePct' ? clampGate(v) : field === 'coveragePct' ? clampCoverage(v)
    : field === 'minutes' ? clampMinutes(v) : clampWords(v)
  return { ...s, presetId: 'custom', [field]: clamped }
}

/** Детский уровень и темп ортогональны пресету — presetId не меняется. */
export function setKids(s: RouteSettings, v: number | null): RouteSettings {
  return { ...s, kidsPct: v === null ? null : clampKids(v) }
}
export function setTempo(s: RouteSettings, v: number): RouteSettings {
  return { ...s, tempo: clampTempo(v) }
}

/** Пресет, чьи четыре числа совпали с текущими (для сверки записанного значения). */
function presetMatching(s: PresetValues): PresetKey | null {
  for (const id of ['comfort', 'balanced', 'fast'] as const) {
    const p = ROUTE_PRESETS[id]
    if (p.gatePct === s.gatePct && p.coveragePct === s.coveragePct && p.minutes === s.minutes && p.words === s.words) return id
  }
  return null
}

/**
 * settingsBody — поля тела быстрого старта. Ровно выбранные значения; ключи
 * min_r_clean_override и tempo_over_goal_wpm — только когда заданы (никогда не 0
 * и не пустое): демон читает присутствие ключа.
 */
export function settingsBody(s: RouteSettings, tempoEnabled: boolean = ROUTE_TEMPO_OVER_GOAL): Record<string, number> {
  const body: Record<string, number> = {
    comprehensibility_max: s.gatePct / 100,
    target_coverage: s.coveragePct / 100,
    daily_listening_budget_min: s.minutes,
    daily_new_words: s.words,
  }
  if (s.kidsPct !== null) body.min_r_clean_override = s.kidsPct / 100
  if (tempoEnabled && s.tempo > 0) body.tempo_over_goal_wpm = s.tempo
  return body
}

// --- хранение (на браузер; сервер после старта главнее) ------------------------------

export const SETTINGS_KEY = 'flib:route:settings:v1'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function loadSettings(): RouteSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const j = JSON.parse(raw) as Record<string, unknown>
    if (j === null || typeof j !== 'object') return DEFAULT_SETTINGS
    const base: PresetValues = {
      gatePct: isNum(j.gatePct) ? clampGate(j.gatePct) : DEFAULT_SETTINGS.gatePct,
      coveragePct: isNum(j.coveragePct) ? clampCoverage(j.coveragePct) : DEFAULT_SETTINGS.coveragePct,
      minutes: isNum(j.minutes) ? clampMinutes(j.minutes) : DEFAULT_SETTINGS.minutes,
      words: isNum(j.words) ? clampWords(j.words) : DEFAULT_SETTINGS.words,
    }
    // Подпись пресета сверяется с числами: расхождение (ручная правка записи) — «custom».
    const id = presetMatching(base)
    return {
      ...base,
      presetId: id ?? 'custom',
      kidsPct: isNum(j.kidsPct) ? clampKids(j.kidsPct) : null,
      tempo: isNum(j.tempo) ? clampTempo(j.tempo) : 0,
    }
  } catch { return DEFAULT_SETTINGS }
}

export function saveSettings(s: RouteSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* без хранилища — не сохраняется */ }
}
