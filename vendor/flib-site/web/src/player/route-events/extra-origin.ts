// extra-origin.ts — метка происхождения события дополнительного видео
// (спека extra-video §7, §9). Функция только ПОМЕЧАЕТ событие; единственное место
// отправки событий плеера — commit в useRouteEvents, там её и вызывают. Чистая и
// тотальная: вход не меняется, на любой вход — ответ.
import type { SiteEvent } from './mapper'

// Роды, у которых демон читает `origin:"more"` (§7). `clip_replayed` и `clipboard_copy`
// не входят: перемотка назад повтора не отнимает.
export const EXTRA_KINDS: ReadonlySet<string> = new Set([
  'clip_played', 'subtitles_shown', 'hint_requested', 'translation_opened',
  'word_added_to_dict', 'word_marked_unheard', 'line_translated',
])

export function asExtraEvent(ev: SiteEvent): SiteEvent | null {
  if (!EXTRA_KINDS.has(ev.type)) return null
  return { ...ev, origin: 'more' }
}
