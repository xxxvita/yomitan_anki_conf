// parseVideoId — извлекает 11-символьный YouTube video_id из ссылки/ID.
// Используется StartPage/RouteToolsPanel (существующие call sites) И
// [ID:P-abstract-goals] YoutubeGoalDialog визарда /try (contract §1 D6):
// «Свой пример (YouTube)» — L11 контракта требует РАСШИРИТЬ ЭТОТ парсер, не
// дублировать его — таймкод/плейлист-параметры (`&t=30s`, `&list=...`)
// игнорируются сами по себе: `{11}` захватывает РОВНО 11 разрешённых
// символов сразу после префикса, хвостовые query-параметры лежат за
// пределами матча.
export function parseVideoId(input: string): string | null {
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/)
  if (m) return m[1]
  const t = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t
  return null
}
