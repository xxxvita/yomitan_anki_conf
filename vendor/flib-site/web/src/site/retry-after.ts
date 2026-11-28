// retry-after.ts — единый парсер Retry-After для клиентских BFF-ручек.
// Возвращает СЕКУНДЫ (>0) или null — «сервер не сказал ничего парсибельного».
//
// ⚠️ null, НЕ дефолт (Fable HIGH-3): useSubtitles трактует null как «не знаем,
// когда → НЕ поллить» (иначе долбил бы 503-без-инфо). Вызывающий, которому
// нужен дефолт (translate-api), применяет `?? N` сам.
//
// BODY-FIRST (канон useSubtitles: «тело приоритетный канал»): тело приоритетно,
// заголовок — fallback. Два ключа тела у разных BFF-ручек: `retry_after_seconds`
// (subs.go/писатель 503) И `retry_after_sec` (gate.go writeRateLimited) — покрываем обе.
export function parseRetryAfterSec(header: string | null, body: unknown): number | null {
  const b = body as { retry_after_seconds?: unknown; retry_after_sec?: unknown } | null | undefined
  const bodySecs = numPos(b?.retry_after_seconds) ?? numPos(b?.retry_after_sec)
  if (bodySecs != null) return bodySecs
  const headerSecs = header != null ? Number(header) : NaN
  return Number.isFinite(headerSecs) && headerSecs > 0 ? headerSecs : null
}

function numPos(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
