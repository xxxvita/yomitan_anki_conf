// word-events.ts — память посланных пословных событий одного открытия ролика
// (порт `route-word-events.ts` приложения, план B8a).
//
// Ключ — род, слово и ЛОКАЛЬНЫЙ ключ: у `subtitles_shown` это `sub_ref` (раз на
// пару реплика+слово), у `line_translated` — `c<i>` строки (в событие не уходит,
// как `dedupKey` приложения), у прочих — пусто (слово раз на ролик). То же слово
// в ДРУГОМ ролике — второе свидетельство: память чистится при смене ролика.

export class WordEventMemory {
  private sent = new Set<string>()

  // take — слова, ещё не посланные с этим ключом; помечает их посланными.
  take(type: string, words: string[], key = ''): string[] {
    const fresh: string[] = []
    for (const w of words) {
      const k = `${type}\u0000${w}\u0000${key}`
      if (this.sent.has(k)) continue
      this.sent.add(k)
      fresh.push(w)
    }
    return fresh
  }

  // release — событие не поставлено в очередь: слова снова можно послать.
  release(type: string, words: string[], key = ''): void {
    for (const w of words) this.sent.delete(`${type}\u0000${w}\u0000${key}`)
  }

  forget(): void { this.sent.clear() }
}
