// vocab.ts — словарь пользователя ("что уже знаю") в localStorage (Phase 2, п.A).
//
// Ключ `flib:vocab`. Структура — МАПА слово→метаданные (не массив): дедуп по
// слову — часть модели данных, а не постфактум-фильтр над списком (тот же
// принцип, что flib:pointA/flib:route — источник истины лежит целиком в одном
// ключе, см. route-state.ts). Слово, уже известное словарю, НЕ перезаписывает
// свои added_at/source при повторном addWords — "впервые узнали" не должно
// съезжать вперёд оттого, что то же слово встретилось снова (route-шаг
// пройден второй раз / повторная загрузка того же файла).
//
// Источники наполнения (Phase 2): B — слова пройденного шага маршрута
// (source='learned', route-step-nav.ts); C — материализация CEFR-точки-А
// (source='cefr') или words-точки-А (source=pointA.source ?? 'upload');
// D — ручная загрузка файла словаря (source='upload', importWords).
const VOCAB_KEY = 'flib:vocab'

export interface VocabEntry {
  /** ISO-таймстамп первого попадания слова в словарь. */
  added_at: string
  /** Источник первого попадания: 'learned' | 'cefr' | 'upload' | 'test' | ... —
   *  не закрытый enum (см. G5-аналог для TS: не документируем как исчерпывающий
   *  список, источники добавляются по мере появления новых точек входа). */
  source: string
}

export interface VocabState {
  words: Record<string, VocabEntry>
  /** ISO-таймстамп последней РЕАЛЬНОЙ мутации (когда хоть одно новое слово
   *  добавилось) — не трогается вызовом addWords, который целиком состоит из
   *  уже известных слов (иначе timestamp шумел бы без содержательного события). */
  updated_at: string
}

function emptyVocab(): VocabState {
  return { words: {}, updated_at: new Date(0).toISOString() }
}

// loadVocab — лениво читает flib:vocab. Чужая схема/битый JSON в этом ключе →
// пустой словарь, не падение (тот же принцип, что loadRoute/loadPointA:
// вызывающий код трактует это как "словаря ещё нет"). Это read path без
// последующего RMW-перезатирания чужих данных внутри loadVocab самой —
// addWords ниже читает через тот же loadVocab и если словарь был битым, он и
// был для пользователя фактически потерян ДО этого вызова (валидная деградация
// уровня всего фронтового Э2/Э3 localStorage-слоя, не регрессия этой задачи).
export function loadVocab(): VocabState {
  try {
    const raw = window.localStorage.getItem(VOCAB_KEY)
    if (!raw) return emptyVocab()
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.words && typeof parsed.words === 'object') {
      return parsed as VocabState
    }
    return emptyVocab()
  } catch {
    return emptyVocab()
  }
}

function saveVocab(state: VocabState): void {
  try {
    window.localStorage.setItem(VOCAB_KEY, JSON.stringify(state))
  } catch {
    // QuotaExceededError / localStorage недоступен (приватный режим) — не
    // роняем UI, словарь просто не переживёт эту сессию (тот же принцип, что
    // saveRoute в route-state.ts). Вызывающая сторона (addWords) уже вернула
    // корректный in-memory результат до этого вызова — потеря молчаливая, но
    // не искажающая то, что видит пользователь ПРЯМО СЕЙЧАС.
  }
}

/** Нормализация слова для ключа словаря — trim+lowercase, тот же принцип, что
 *  parse-vocab.ts normalizeTokens (регистр не должен плодить дубли: "Cat" и
 *  "cat" — одно и то же слово словаря). */
function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase()
}

// addWords — RMW: читает текущий словарь, добавляет НОВЫЕ слова (уже известные
// не трогает — см. doc-комментарий VocabEntry), пишет обратно. Пустой массив
// или массив из уже известных слов — no-op: ни записи в localStorage, ни
// изменения updated_at (нечего фиксировать содержательно).
export function addWords(words: string[], source: string): VocabState {
  const current = loadVocab()
  let changed = false
  const nextWords = { ...current.words }
  const nowIso = new Date().toISOString()

  for (const raw of words) {
    const w = normalizeWord(raw)
    if (!w) continue
    if (nextWords[w]) continue // уже известно — added_at/source не трогаем
    nextWords[w] = { added_at: nowIso, source }
    changed = true
  }

  if (!changed) return current

  const next: VocabState = { words: nextWords, updated_at: nowIso }
  saveVocab(next)
  return next
}

// importWords — та же дедуп/персист-логика, что addWords; отдельное имя для
// call-site'ов "Загрузить словарь" (D), где семантика "импорт файла" отличается
// от "выучил, проходя маршрут" (B) читаемостью кода, не поведением.
export const importWords = addWords

// exportKnoWords — плоский массив для скачивания (D), совместимый по форме с
// parse-vocab.ts (принимает [{word, added_at?, source?}]) — round-trip
// "скачал → тот же файл можно снова загрузить": СЛОВА переживают (это главное,
// «что знаю»). ⚠ added_at/source — метаданные экспорта: обратный парсер
// (parse-vocab → importWords) берёт только word и ставит свежий added_at +
// source='upload'; исходные метаданные при re-import НЕ восстанавливаются
// (пока ничем не потребляются — аудит MED-2).
export function exportKnoWords(): Array<{ word: string; added_at: string; source: string }> {
  const { words } = loadVocab()
  return Object.entries(words).map(([word, entry]) => ({ word, added_at: entry.added_at, source: entry.source }))
}

export function vocabCount(): number {
  return Object.keys(loadVocab().words).length
}

export function clearVocab(): void {
  try {
    window.localStorage.removeItem(VOCAB_KEY)
  } catch {
    // localStorage недоступен — уже нечего чистить, no-op.
  }
}
