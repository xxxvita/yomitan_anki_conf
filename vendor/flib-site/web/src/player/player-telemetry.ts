// player-telemetry.ts — чистая логика поведенческой телеметрии плеера, вынесенная
// из PlayerPage для юнит-тестируемости (PlayerPage целиком в RTL не поднять).
// Транспорт — web/src/site/telemetry.ts (track/subLineHash/onTerminalFlush).
import { subLineHash } from '../site/telemetry'

// round2 — таймкоды/доли в лог с точностью до сотых: секунды видео и watched_pct
// не нуждаются в 15 знаках float, шум раздувает JSONL и мешает глазами читать лог.
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

// watchedPct — доля просмотра [0..1]. duration ещё 0 (плеер не готов) / NaN /
// отрицательный → 0, а не NaN/Infinity в логе. Кламп сверху: currentTime может
// на мгновение превысить duration у некоторых плееров на самом конце.
export function watchedPct(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  const pct = currentTime / duration
  if (!Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(1, round2(pct)))
}

export interface RewindInput {
  fromTime: number
  toTime: number
  videoId?: string
  routeGoal?: string
  /** Текст активной строки субтитра на момент перемотки (для КОНТЕНТ-хэша). */
  lineText?: string
}

// createRewindTracker — построитель payload'а события rewind, ХРАНЯЩИЙ хэш
// последней перемотанной строки, чтобы отметить repeat_on_same_line (N-я
// перемотка подряд по той же реплике = явный сигнал трудности).
//
// Возвращает payload ТОЛЬКО для перемотки НАЗАД (toTime < fromTime); вперёд/
// no-op → null (перемотки вперёд по ТЗ не снимаем — это не сигнал трудности).
// Единая точка на все источники сика (стрелки, ctrl-стрелки к прошлой реплике,
// драг сик-бара назад): все зовут один seek-обёртку в PlayerPage.
export function createRewindTracker(): (input: RewindInput) => Record<string, unknown> | null {
  let lastHash: string | null = null
  return (input: RewindInput): Record<string, unknown> | null => {
    if (!(input.toTime < input.fromTime)) return null
    const hasLine = typeof input.lineText === 'string' && input.lineText.trim().length > 0
    const hash = hasLine ? subLineHash(input.lineText as string) : undefined
    const repeat = hash != null && hash === lastHash
    if (hash != null) lastHash = hash
    return {
      video_id: input.videoId,
      route_goal: input.routeGoal,
      from_time: round2(input.fromTime),
      to_time: round2(input.toTime),
      timecode: round2(input.fromTime),
      sub_line_hash: hash,
      repeat_on_same_line: repeat,
    }
  }
}

// watchProgressPayload — общий строитель тела watch_progress (периодического и
// финального), чтобы поле-в-поле совпадали. final=true у события на pagehide —
// это точка броска сессии.
export function watchProgressPayload(args: {
  videoId?: string
  routeGoal?: string
  currentTime: number
  duration: number
  final?: boolean
}): Record<string, unknown> {
  return {
    video_id: args.videoId,
    route_goal: args.routeGoal,
    timecode: round2(args.currentTime),
    current_time: round2(args.currentTime),
    watched_pct: watchedPct(args.currentTime, args.duration),
    ...(args.final ? { final: true } : {}),
  }
}

// ---- ab_loop телеметрия (A-B зацикливание) ----
//
// Одно событие на завершённую СЕССИЮ лупа: юзер включил A-B на отрезке, покрутил
// N раз, вышел. Вся session-логика — здесь, чистая и юнит-тестируемая (PlayerPage
// целиком в RTL не поднять); PlayerPage — тонкий glue (эффект + стабильная
// обёртка onLoopRestart + onTerminalFlush). Хук useWorkspace НЕ трогаем.
//
// `now` во ВСЕХ входах — ОБЯЗАТЕЛЕН (инъекция Date.now() снаружи): трекер не
// зовёт Date.now() сам → тесты детерминированы.

// Порог «значимости» сессии. Ниже него И при 0 повторов сессия считается
// тривиальной (артефакт драга ручки A-B, который зовёт setRange на каждый
// pointermove; или пустой сплит-огрызок после terminal) — НЕ эмитим, чтобы не
// засорять лог штормом событий с duration≈0.
const AB_MIN_SESSION_S = 1

export type AbLoopExitReason = 'user' | 'video_change' | 'terminal'

export interface AbLoopEnded {
  rangeStart: number
  rangeEnd: number
  videoId: string
  repeatCount: number
  durationS: number
  exitReason: AbLoopExitReason
}

interface AbLoopOpen {
  rangeStart: number
  rangeEnd: number
  videoId: string
  repeatCount: number
  startedAt: number
}

export interface AbLoopStateInput {
  /** ws.looping && !panelCollapsed && rangeEnd>rangeStart — считает вызывающий. */
  active: boolean
  rangeStart: number
  rangeEnd: number
  videoId: string
  now: number
}

export interface AbLoopTracker {
  noteState(input: AbLoopStateInput): AbLoopEnded | null
  noteRestart(): void
  noteTerminal(input: { now: number }): AbLoopEnded | null
}

function abDurationS(startedAt: number, now: number): number {
  // Секунды, не мс (поле duration_s). Кламп снизу на 0 — часы могли шагнуть назад.
  return Math.max(0, round2((now - startedAt) / 1000))
}

function abMeaningful(s: AbLoopOpen, now: number): boolean {
  return s.repeatCount > 0 || (now - s.startedAt) / 1000 >= AB_MIN_SESSION_S
}

function abEnd(s: AbLoopOpen, reason: AbLoopExitReason, now: number): AbLoopEnded {
  return {
    rangeStart: s.rangeStart,
    rangeEnd: s.rangeEnd,
    videoId: s.videoId,
    repeatCount: s.repeatCount,
    durationS: abDurationS(s.startedAt, now),
    exitReason: reason,
  }
}

function abOpen(i: { rangeStart: number; rangeEnd: number; videoId: string; now: number }): AbLoopOpen {
  return { rangeStart: i.rangeStart, rangeEnd: i.rangeEnd, videoId: i.videoId, repeatCount: 0, startedAt: i.now }
}

// createAbLoopTracker — конечный автомат сессии лупа. Идентичность сессии =
// (active, rangeStart, rangeEnd, videoId): смена диапазона при активном лупе — это
// новая сессия (ретаргет), а не продолжение (Fable HIGH-1). Возвращает
// ЗАВЕРШЁННУЮ сессию (или null) — хэши реплик тут НЕ считаются (нет text_en),
// их резолвит buildAbLoopPayload на эмите.
export function createAbLoopTracker(): AbLoopTracker {
  let open: AbLoopOpen | null = null

  return {
    noteState(i: AbLoopStateInput): AbLoopEnded | null {
      if (open) {
        // 1) Выключение (в т.ч. disable+смена видео в один тик → 'user': disable
        //    выигрывает порядок веток, Fable branch-order).
        if (!i.active) {
          const ended = abEnd(open, 'user', i.now)
          open = null
          return ended
        }
        // 2) Смена видео при активном лупе — закрыть 'video_change', НЕ пере-открывать
        //    (Fable HIGH-1: иначе фантом со старым диапазоном под новым videoId).
        if (i.videoId !== open.videoId) {
          const ended = abEnd(open, 'video_change', i.now)
          open = null
          return ended
        }
        // 3) Ретаргет диапазона при активном лупе.
        if (i.rangeStart !== open.rangeStart || i.rangeEnd !== open.rangeEnd) {
          if (abMeaningful(open, i.now)) {
            const ended = abEnd(open, 'user', i.now)
            open = abOpen(i)
            return ended
          }
          // Тривиальный ретаргет (драг ручки: <1с, 0 повторов) — тихо мержим:
          // двигаем диапазон, сбрасываем таймер, счётчик 0, НЕ эмитим (Fable CRIT-1).
          open.rangeStart = i.rangeStart
          open.rangeEnd = i.rangeEnd
          open.startedAt = i.now
          return null
        }
        // 4) То же самое (идемпотентно — StrictMode двойной прогон эффекта).
        return null
      }
      // Нет открытой — открываем на active.
      if (i.active) open = abOpen(i)
      return null
    },

    noteRestart(): void {
      if (open) open.repeatCount++ // гейт по открытой сессии = фантом-гард
    },

    noteTerminal(i: { now: number }): AbLoopEnded | null {
      // ВСЕГДА закрываем открытую сессию (open=null), эмитим ЛИШЬ значимую.
      // visibilitychange(hidden) бьёт на КАЖДЫЙ alt-tab, не только на реальный
      // уход. НЕ закрывать незначимый огрызок (0 повторов, <1с) означало бы: он
      // остаётся открытым, юзер возвращается через 10 минут, крутит и выключает —
      // и всё время сворачивания вкладки втекает в его duration_s (Fable финал
      // MED-2). Всегда-закрытие убивает и это, и даёт дедуп: второй terminal того
      // же teardown (hidden+pagehide) видит !open → null. Плата: продолжение
      // лупа на ТОТ ЖЕ диапазон после возврата из alt-tab не учитывается —
      // принятый минорный пробел (exit_reason 'terminal' = «ушёл/свернул»).
      if (!open) return null
      const ended = abMeaningful(open, i.now) ? abEnd(open, 'terminal', i.now) : null
      open = null
      return ended
    },
  }
}

// startCueHash / endCueHash — контент-хэш реплики на границе лупа. Разные правила
// для двух концов чинят off-by-one (Fable HIGH-2): для line-loop rangeStart=cue.start,
// rangeEnd=cue.end — оба конца должны попасть в ОДИН cue.
//   start: cue где start <= t < end   (cue, начинающийся на/покрывающий t)
//   end:   cue где start < t <= end   (cue, ЗАканчивающийся на t)
type HashCue = { start: number; end: number; text_en: string }

export function startCueHash(cues: HashCue[], t: number): string | undefined {
  const c = cues.find(c => c.start <= t && t < c.end)
  return c ? subLineHash(c.text_en) : undefined
}

export function endCueHash(cues: HashCue[], t: number): string | undefined {
  const c = cues.find(c => c.start < t && t <= c.end)
  return c ? subLineHash(c.text_en) : undefined
}

// buildAbLoopPayload — чистый строитель тела ab_loop. Хэши резолвятся на ЭМИТЕ из
// ТЕКУЩИХ cues (к этому моменту субтитры загружены — чинит гонку hash-at-enable).
// Только если ended.videoId === текущему (иначе cues уже от другого ролика →
// хэши опускаем). range_end_hash — ТОЛЬКО если отличается от sub_line_hash
// (мульти-cue диапазон); ключ ОТСУТСТВУЕТ, а не undefined-значение.
export function buildAbLoopPayload(
  ended: AbLoopEnded,
  currentVideoId: string,
  cues: HashCue[],
  routeGoal: string | undefined,
): Record<string, unknown> {
  const sameVideo = ended.videoId === currentVideoId
  const sh = sameVideo ? startCueHash(cues, ended.rangeStart) : undefined
  const eh = sameVideo ? endCueHash(cues, ended.rangeEnd) : undefined
  return {
    video_id: ended.videoId,
    route_goal: routeGoal,
    repeat_count: ended.repeatCount,
    duration_s: ended.durationS,
    exit_reason: ended.exitReason,
    range_start: round2(ended.rangeStart),
    range_end: round2(ended.rangeEnd),
    ...(sh ? { sub_line_hash: sh } : {}),
    ...(eh && eh !== sh ? { range_end_hash: eh } : {}),
  }
}
