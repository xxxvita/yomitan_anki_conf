// knowledge-model.ts — чистая модель страницы «Мои знания»: тексты ошибок,
// разбор ответа разбора, страницы списка выбора. Без React и запросов.
// Русские строки — из приложения (ru.ts, material.*, knowledge.*), где подходят.
import type { ApiError } from '../route/route-api'
import { retryDelaySec } from '../route/route-api'
import type { AnalyzeOk, NewWord } from './knowledge-api'

export const REVIEW_PAGE = 50
export const TEXT_MAX_BYTES = 200_000

export interface Failure {
  code: string
  text: string
  offerApp: boolean // предложить «Скачать Flibooster»
  retry: boolean    // «Повторить» уместно
  session: boolean  // сессия недействительна — перечитать
}

function wait(e: ApiError): string {
  const s = retryDelaySec(e)
  return s >= 90 ? `через ${Math.ceil(s / 60)} мин` : `через ${s} с`
}

// YOUTUBE_LINK_HINT — подсказка под полем, если в нём не ссылка на ролик (макет §5).
export const YOUTUBE_LINK_HINT = 'Нужна ссылка на ролик YouTube'

const VIDEO_ID_RE = /(?:[?&]v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/

// youtubeVideoId — id ролика из ссылки или null. Только подсказка для кнопки:
// решает BFF (parseYouTubeID), он строже — чужой хост получит bad_youtube_url.
export function youtubeVideoId(url: string): string | null {
  return VIDEO_ID_RE.exec(url.trim())?.[1] ?? null
}

// describeAnalyzeError — ошибка разбора → понятный текст. Текст про «сервер
// разбора слов» — только для сбоев самого разборщика; субтитры YouTube, чтение
// словаря и сессия говорят каждый своим.
export function describeAnalyzeError(e: ApiError): Failure {
  const f = (code: string, text: string, o: Partial<Failure> = {}): Failure =>
    ({ code, text, offerApp: false, retry: true, session: false, ...o })
  if (e.status === 401) return f('session', 'Сессия закончилась. Войдите ещё раз.', { retry: false, session: true })
  const c = e.code ?? ''
  switch (c) {
    case 'youtube_unavailable':
      // 503 + retryable — временный сбой получения субтитров (шлюз/сеть), не свойство ролика.
      if (e.status === 503 || e.body?.retryable === true) {
        return f(c, 'Не удалось получить субтитры ролика прямо сейчас. Повторите через минуту. В программе Flibooster такие ролики разбираются целиком.', { offerApp: true, retry: true })
      }
      return f(c, 'Не удалось получить субтитры этого ролика. В программе Flibooster такие ролики разбираются целиком — там всё уже работает, знания загружаются быстрее и в полном объёме.', { offerApp: true, retry: false })
    case 'bad_youtube_url': return f(c, YOUTUBE_LINK_HINT, { retry: false })
    case 'text_too_large':
    case 'body_too_large': return f(c, 'Текст слишком большой (больше 200 КБ)', { retry: false })
    case 'daily_limit': {
      const lim = typeof e.body?.limit === 'number' ? e.body.limit : 20
      return f(c, `Лимит разборов на сегодня исчерпан (${lim} в день) — продолжим завтра`, { retry: false })
    }
    case 'busy': return f(c, 'Уже идёт другой разбор. Подождите минуту и повторите.')
    case 'analyzer_timeout': return f(c, 'Сервер разбора слов не ответил вовремя. Попробуйте через несколько минут')
    case 'analyzer_unavailable': return f(c, 'Сервер разбора слов сейчас недоступен. Попробуйте позже')
    case 'gateway_unavailable': return f(c, 'Сервер сейчас недоступен. Попробуйте позже')
    case 'route_forbidden': return f(c, 'Для этого ключа разбор материалов недоступен.', { retry: false })
    case 'key_expired': return f(c, 'Срок действия ключа закончился.', { retry: false })
    case 'rate_limited':
    case 'rate_limit_exceeded':
    case 'route_banned':
    case 'too_many_open_jobs': return f(c, `Слишком много запросов. Повторите ${wait(e)}.`)
  }
  if (e.status === 0) return f('network', 'Не удалось связаться с сервером. Проверьте интернет и повторите.')
  if (e.status === 429) return f('rate_limited', `Слишком много запросов. Повторите ${wait(e)}.`)
  return f('unknown', 'Сервер сейчас недоступен. Попробуйте позже')
}

// describeSaveError — ошибка записи слов.
export function describeSaveError(e: ApiError): Failure {
  const f = (code: string, text: string, o: Partial<Failure> = {}): Failure =>
    ({ code, text, offerApp: false, retry: true, session: false, ...o })
  if (e.status === 401) return f('session', 'Сессия закончилась. Войдите ещё раз.', { retry: false, session: true })
  switch (e.code) {
    case 'too_many_words':
      // «Предел 200 000» — только когда упёрлись в предел словаря; потолок одного запроса — другое.
      return e.body?.scope === 'profile'
        ? f('too_many_words', `В словаре слишком много слов — больше добавить нельзя (предел ${Number(e.body?.limit ?? 200000).toLocaleString('ru-RU')}).`, { retry: false })
        : f('too_many_words', 'Не удалось добавить слова: их слишком много за один раз. Добавьте часть слов.', { retry: false })
    case 'busy': return f('busy', 'Словарь меняли в другом месте. Повторите ещё раз.')
    case 'rate_limited': return f('rate_limited', `Слишком часто. Повторите ${wait(e)}.`)
  }
  if (e.status === 0) return f('network', 'Не удалось связаться с сервером. Слова не добавлены — повторите.')
  return f('unknown', 'Не удалось добавить слова. Повторите ещё раз.')
}

export type AnalyzeResult =
  | { s: 'no_words' }
  | { s: 'all_known' }
  | { s: 'ready'; words: NewWord[] }

// classifyAnalyze — «английских слов нет», «всё уже известно» или список.
export function classifyAnalyze(r: AnalyzeOk): AnalyzeResult {
  if (!r.token_count) return { s: 'no_words' }
  if (!r.new_words || r.new_words.length === 0) return { s: 'all_known' }
  return { s: 'ready', words: r.new_words }
}

export function pageCount(n: number, size = REVIEW_PAGE): number {
  return Math.max(1, Math.ceil(n / size))
}

export function pageSlice<T>(items: T[], page: number, size = REVIEW_PAGE): T[] {
  return items.slice(page * size, page * size + size)
}

// batches — слова пачками для save (BFF принимает не больше batch за раз).
export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

// statusLabel — статус слова профиля для списка «Слова».
export function statusLabel(status: string): string {
  return status === 'learning' || status === 'new' ? 'учу' : 'знаю'
}
