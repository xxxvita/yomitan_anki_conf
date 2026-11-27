// examples-api.ts — T1a «видео-примеры по слову»
// (docs/contract-2026-07-15-examples-by-word.md): клиент GET /api/examples.
//
// Контракт: youtube-примеры НИКОГДА не несут таймкод/текст (start_ms/end_ms/
// text_en/text_ru всегда null) — играются целым видео БЕЗ таймкода. film-
// примеры несут и то, и другое. thumbnail_url — nullable у обоих (фронт сам
// строит превью для youtube из i.ytimg.com, см. VideoChatPanel.tsx).
export type ExamplesKind = 'youtube' | 'film' | 'any'

export interface ExampleItem {
  source: string // "youtube" | "film" | "episode"
  ref: string // youtube: video_id; film: clip_id (puzzle_id)
  start_ms: number | null
  end_ms: number | null
  text_en: string | null
  text_ru: string | null
  thumbnail_url: string | null
}

interface ExamplesResponseDTO {
  word: string
  items: ExampleItem[]
}

// ExamplesResult — размеченное объединение вместо throw: попап/панель — не
// критичный путь страницы (тот же принцип, что reportVideoFeedback глотает
// сетевые ошибки в console.warn), но UI ДОЛЖЕН уметь различить "гейтвей ещё
// не готов" (503 → "примеры скоро", не ошибка) от настоящей ошибки.
export type ExamplesResult =
  | { status: 'ok'; items: ExampleItem[] }
  | { status: 'not_ready' } // BFF: 503 examples_not_ready (ручка гейтвея T1a ещё не существует)
  | { status: 'error'; message: string }

// fetchExamples: GET /api/examples?word=&kind=. word кодируется через
// encodeURIComponent — кириллица/пробелы/спецсимволы (слово может прийти из
// субтитров с апострофом типа "don't") не должны сломать query-строку.
export async function fetchExamples(word: string, kind: ExamplesKind): Promise<ExamplesResult> {
  try {
    const res = await fetch(`/api/examples?word=${encodeURIComponent(word)}&kind=${kind}`)
    if (res.status === 503) return { status: 'not_ready' }
    if (!res.ok) return { status: 'error', message: `Не удалось загрузить примеры (${res.status})` }
    const data = (await res.json()) as Partial<ExamplesResponseDTO>
    // Аудит-паттерн api.ts (buildRoute): сырой ответ сервера не бросает
    // TypeError в рендер, если форма неожиданная — явная error-ветка.
    if (!data || !Array.isArray(data.items)) {
      return { status: 'error', message: 'Сервер вернул примеры в неожиданном формате' }
    }
    return { status: 'ok', items: data.items }
  } catch {
    // Сеть недоступна / fetch кинул — тот же класс ошибки, что 5xx для UI
    // (показываем "не удалось загрузить"), не роняем страницу.
    return { status: 'error', message: 'Сеть недоступна, попробуйте ещё раз' }
  }
}
