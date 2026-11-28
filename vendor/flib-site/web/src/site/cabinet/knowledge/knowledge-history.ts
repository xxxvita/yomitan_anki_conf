// knowledge-history.ts — вкладка «Источники»: история добавленного материала,
// хранится ТОЛЬКО в этом браузере (localStorage). Хранилище может быть
// недоступно, переполнено или содержать не то — страница работает в любом случае.

export const HISTORY_KEY_BASE = 'flib:knowledge-sources:v1'
// История — по ключу: на общем компьютере другой ключ не видит чужие источники.
export const historyKey = (keyPrefix: string): string => `${HISTORY_KEY_BASE}:${keyPrefix || 'anon'}`
export const HISTORY_MAX = 100

export interface SourceEntry {
  kind: 'text' | 'youtube'
  title: string
  video_id?: string
  at: string // ISO
  added: number
}

const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/

function valid(e: unknown): e is SourceEntry {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  if (o.kind !== 'text' && o.kind !== 'youtube') return false
  if (typeof o.title !== 'string' || typeof o.at !== 'string') return false
  if (typeof o.added !== 'number' || !Number.isFinite(o.added) || o.added < 0) return false
  if (o.video_id !== undefined && (typeof o.video_id !== 'string' || !VIDEO_RE.test(o.video_id))) return false
  return Number.isFinite(Date.parse(o.at))
}

export function readHistory(keyPrefix: string): SourceEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(keyPrefix))
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(valid).slice(0, HISTORY_MAX).map(e => ({ ...e, title: e.title.slice(0, 200) }))
  } catch { return [] }
}

// addHistory — новая запись сверху; в списке не больше HISTORY_MAX. Возвращает
// актуальный список (даже если запись в хранилище не удалась).
export function addHistory(keyPrefix: string, e: SourceEntry): SourceEntry[] {
  const next = [e, ...readHistory(keyPrefix)].slice(0, HISTORY_MAX)
  try { localStorage.setItem(historyKey(keyPrefix), JSON.stringify(next)) } catch { /* квота, приватный режим */ }
  return next
}

export function clearHistory(keyPrefix: string): void {
  try { localStorage.removeItem(historyKey(keyPrefix)) } catch { /* нечего чистить */ }
}

// clearAllKnowledgeHistory — «Выход»: история всех ключей этого браузера (и
// прежний ключ без привязки к ключу) стирается, на общем компьютере она не
// должна пережить сессию.
export function clearAllKnowledgeHistory(): void {
  try {
    const drop: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k === HISTORY_KEY_BASE || k.startsWith(`${HISTORY_KEY_BASE}:`))) drop.push(k)
    }
    for (const k of drop) localStorage.removeItem(k)
  } catch { /* хранилище недоступно */ }
}

// textTitle — название источника «Текст»: начало текста одной строкой.
export function textTitle(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (!s) return 'Текст'
  return s.length > 60 ? s.slice(0, 60).trimEnd() + '…' : s
}
