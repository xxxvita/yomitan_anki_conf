// materialize-vocab.ts — Phase 2, п.C: точка А → flib:vocab при успешной
// сборке маршрута (вызывается из RoutePage.runBuild, ПОСЛЕ saveRoute).
//
// kind='words' уже несёт реальный список слов на фронте (ImportPage/TryPage
// собрали его сами) — просто кладём в vocab, без сети. kind='cefr' несёт
// только уровень — слова разворачивает бэк СУЩЕСТВУЮЩЕЙ ручкой
// GET /api/dicts/cefr/{level} (internal/bff/cefr_dict.go, тот же
// CEFRCorpus.WordsForLevel, что гидратирует known_words внутри /api/route).
// Отдельную /api/vocab/cefr не заводим — дублировала бы эту (Fable-дедуп).
//
// Best-effort: сеть недоступна / бэк ответил не 200 / формат неожиданный —
// НЕ бросаем и не мешаем сборке маршрута (та же логика уже завершилась и
// показана пользователю к моменту вызова этой функции) — обогащение словаря
// вторично по отношению к самому маршруту.
import type { PointA } from './pointA'
import { addWords } from './vocab'

export async function materializeVocabFromPointA(pointA: PointA): Promise<void> {
  if (pointA.kind === 'words') {
    addWords(pointA.words, pointA.source)
    return
  }

  try {
    const res = await fetch(`/api/dicts/cefr/${encodeURIComponent(pointA.level)}`)
    if (!res.ok) return
    const data = (await res.json()) as Partial<{ words: string[] }>
    if (!Array.isArray(data.words)) return
    addWords(data.words, 'cefr')
  } catch {
    // Сеть недоступна / fetch кинул — глотаем, тот же принцип, что
    // reportVideoFeedback/reportRouteNext (ab-events.ts): не критичный путь.
  }
}
