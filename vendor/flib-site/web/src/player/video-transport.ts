// video-transport.ts [ID:P-hybrid] — session-scoped выбор транспорта плеера
// (iframe|native). ДЕШЁВЫЙ ВРЕМЕННЫЙ гибрид на время A/B-теста маршрута (см.
// PlayerRoot.tsx PlayerTransport, NativeVideoAdapter.ts, UnplayableOverlay.tsx
// «Смотреть через flib-плеер (бета)»). Тот же PURE read/write seam-паттерн,
// что shadow-mic-consent.ts (typed, storage-injectable, юнит-тестируем без
// монтирования PlayerPage) — единственная персистентная часть переключения:
// «следующие шаги маршрута в этой сессии сразу открываются нативно» (владелец
// задачи п.2b) — тестер не воюет со стеной на каждом шаге заново.
export type PlayerTransportChoice = 'iframe' | 'native'

/** sessionStorage key. Значение — литерал 'native', когда (и только когда) выставлено. */
export const TRANSPORT_STORAGE_KEY = 'flib:transport'

const NATIVE = 'native'

function pick(storage?: Storage): Storage | null {
  if (storage) return storage
  // jsdom/prod оба дают sessionStorage, но приватный режим/отключённый storage
  // может кинуть даже на ДОСТУПЕ — страхуемся, чтение транспорта не должно падать.
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

/**
 * Читает персистентный выбор транспорта. Считается ТОЛЬКО точное значение
 * 'native'; что угодно другое (нет ключа, чужое значение, storage кинул) → null
 * (fail-closed на дефолтный iframe-транспорт).
 */
export function readStoredTransport(storage?: Storage): PlayerTransportChoice | null {
  const s = pick(storage)
  if (!s) return null
  try {
    return s.getItem(TRANSPORT_STORAGE_KEY) === NATIVE ? NATIVE : null
  } catch {
    return null
  }
}

/**
 * Персистит выбор native на остаток браузерной сессии. Best-effort: если
 * storage недоступен/кидает, текущий React-стейт вызывающего всё равно несёт
 * выбор для ЭТОГО монтажа (теряется только межшаговая персистентность).
 */
export function writeStoredTransport(storage?: Storage): void {
  const s = pick(storage)
  if (!s) return
  try {
    s.setItem(TRANSPORT_STORAGE_KEY, NATIVE)
  } catch {
    /* storage отключён/квота — React-стейт всё равно держит выбор в этом монтаже */
  }
}

/**
 * Сбрасывает персистентный выбор native (аудит MED-3/5b [ID:P-hybrid-audit]):
 * кнопка «Вернуться на YouTube-плеер» и явный ?transport=iframe обязаны
 * снимать залипание — иначе native, однажды выбранный, держался все шаги
 * маршрута до конца сессии без пути назад. Best-effort, как write.
 */
export function clearStoredTransport(storage?: Storage): void {
  const s = pick(storage)
  if (!s) return
  try {
    s.removeItem(TRANSPORT_STORAGE_KEY)
  } catch {
    /* storage отключён — React-стейт вызывающего всё равно вернулся на iframe */
  }
}

/**
 * resolveInitialTransport — единая точка входа для начального transport при
 * монтаже PlayerPage: приоритет ?transport=native (владелец п.3: ручной тест)
 * > ?transport=iframe (аудит MED-3 [ID:P-hybrid-audit]: принудительный откат
 * — ЧИСТИТ sessionStorage, а не только перекрывает, иначе следующий шаг
 * маршрута без параметра снова открылся бы native) > персистентный выбор
 * этой сессии (п.2) > дефолт 'iframe' (Track A всегда дефолт — гибрид
 * включается ТОЛЬКО явным действием/параметром).
 */
export function resolveInitialTransport(queryTransport: string | null, storage?: Storage): PlayerTransportChoice {
  if (queryTransport === NATIVE) return NATIVE
  if (queryTransport === 'iframe') {
    clearStoredTransport(storage)
    return 'iframe'
  }
  return readStoredTransport(storage) === NATIVE ? NATIVE : 'iframe'
}
