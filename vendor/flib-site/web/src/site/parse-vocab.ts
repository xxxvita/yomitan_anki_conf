// parse-vocab.ts — чистый парсер файла словаря для /import (ТЗ Э1, докс:
// docs/plan-2026-07-13-design-transfer.md, п.5 задачи «Загрузить словарь»).
//
// Форматы на входе:
//   (а) JSON-массив строк: ["cat", "dog"]
//   (б) JSON-массив объектов known-words.json: [{word, added_at?, source?}]
//   (в) txt/csv — слово на строке ИЛИ через запятую/точку с запятой
//       (эти два способа не взаимоисключающие: разделители запятая/
//       точка-с-запятой/перевод строки трактуются как единый набор
//       границ токенов, так что оба стиля работают в одном файле).
// Расширение файла определяет только то, пробуем ли мы JSON.parse: для
// *.json, чей контент не парсится и не похож на JSON (не начинается с
// '[' или '{'), делаем fallback на txt-разбор — так .json с текстовым
// содержимым внутри не считается "битым JSON".
//
// Нормализация: trim + lowercase + дедуп с сохранением порядка первого
// вхождения + отбрасываем пустые токены и токены без единой буквы
// (юникод-aware \p{L}, чтобы "don't"/"naïve"/"café" сохранялись, а "123"/
// "---" отбрасывались).
export interface ParseVocabResult {
  words: string[]
  errors: string[]
}

// Слово должно содержать латинскую букву (не просто любую \p{L}): целевой
// словарь — английский, а типовой Anki-экспорт двухколоночный
// (word<TAB>перевод / word,перевод) — кириллические переводы отбрасываем,
// латиница с диакритикой (naïve, café) проходит.
const HAS_LETTER = /\p{Script=Latin}/u
// Общий набор разделителей токенов в txt/csv: перевод строки (в т.ч. CRLF),
// таб (Anki-экспорт — это TSV), запятая, точка с запятой — трактуются
// одинаково, так что "слово на строке" и "через запятую" — это один и тот
// же путь разбора.
const TXT_DELIMITERS = /[\r\n\t,;]+/

function normalizeTokens(rawTokens: string[]): { words: string[]; skipped: number } {
  const seen = new Set<string>()
  const words: string[] = []
  let skipped = 0
  for (const raw of rawTokens) {
    const w = raw.trim().toLowerCase()
    if (!w || !HAS_LETTER.test(w)) {
      skipped++
      continue
    }
    if (seen.has(w)) continue
    seen.add(w)
    words.push(w)
  }
  return { words, skipped }
}

function parseTxt(text: string): ParseVocabResult {
  const rawTokens = text.split(TXT_DELIMITERS)
  const { words } = normalizeTokens(rawTokens)
  if (words.length === 0) {
    return { words: [], errors: ['Файл пуст или не содержит распознаваемых слов'] }
  }
  return { words, errors: [] }
}

function looksLikeJson(text: string): boolean {
  const t = text.trim()
  return t.startsWith('[') || t.startsWith('{')
}

function wordFromJsonItem(item: unknown): string | undefined {
  if (typeof item === 'string') return item
  if (item !== null && typeof item === 'object' && 'word' in item) {
    const w = (item as { word: unknown }).word
    if (typeof w === 'string') return w
  }
  return undefined
}

function parseJson(text: string): ParseVocabResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    if (looksLikeJson(text)) {
      return { words: [], errors: ['Не удалось разобрать JSON — проверьте формат файла'] }
    }
    // Расширение .json, но контент — обычный текст: не ошибка, а другой формат.
    return parseTxt(text)
  }

  if (!Array.isArray(parsed)) {
    return { words: [], errors: ['Ожидался JSON-массив слов, получен другой формат'] }
  }

  const rawTokens: string[] = []
  let unrecognized = 0
  for (const item of parsed) {
    const w = wordFromJsonItem(item)
    if (w === undefined) {
      unrecognized++
    } else {
      rawTokens.push(w)
    }
  }

  const { words, skipped } = normalizeTokens(rawTokens)
  const errors: string[] = []
  const totalSkipped = unrecognized + skipped
  if (totalSkipped > 0) errors.push(`Пропущено ${totalSkipped} нераспознанных записей`)
  if (words.length === 0) errors.push('Не найдено ни одного слова')
  return { words, errors }
}

export function parseVocabFile(text: string, filename: string): ParseVocabResult {
  if (!text || !text.trim()) return { words: [], errors: ['Файл пуст'] }

  const dot = filename.lastIndexOf('.')
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''

  if (ext === 'json') return parseJson(text)
  return parseTxt(text)
}
