// link-start.ts — старт плеера с секунды из ссылки /player?v=…&t=… (расширение 0.6.1, карточка примера).
// Чистая функция: никаких эффектов, всё решение — по query.

const T_RE = /^[1-9]\d{0,5}$/
const T_MAX = 86400
// Маршрутные страницы живут по своим правилам (первый проход, гейт субтитров, прогресс) — t там игнорируется.
const ROUTE_KEYS = ['rp', 'rc', 'rx', 'route_step']

// Заметка: «Назад» браузера к такой ссылке (после просмотра другого ролика) может применить t заново —
// это считается новым открытием.
export function parseLinkStart(params: URLSearchParams): number | null {
  for (const k of ROUTE_KEYS) if (params.has(k)) return null
  if (params.get('back') === 'route') return null
  const raw = params.get('t') // повтор t → первое значение (get)
  if (raw === null || !T_RE.test(raw)) return null
  const n = Number(raw)
  return n <= T_MAX ? n : null
}
