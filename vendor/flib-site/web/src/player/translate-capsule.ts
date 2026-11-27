// translate-capsule.ts — чистое ядро решений «капсулы перевода строки» (SPEC §A1).
// Вынесено из PlayerPage для юнит-тестируемости (PlayerPage целиком в RTL не
// поднять) — тот же приём, что player-telemetry.ts / translate-window.ts.
// Никаких React/DOM-зависимостей: чистые предикаты + строитель payload.
import { subLineHash } from '../site/telemetry'
import { round2 } from './player-telemetry'

export type RevealSurface = 'plate' | 'list'
// result — исход нажатия капсулы: 'corpus' (локальное раскрытие уже готового RU
// без HTTP) + полный union translateWindow. 'busy' = серверный 429/503 (запрос
// ушёл), НЕ клиентский single-flight-лок (тот вообще не эмитит — SPEC §5).
export type RevealResult = 'corpus' | 'ok' | 'empty' | 'busy' | 'not_in_corpus' | 'forbidden' | 'error'

// capsuleVisible — общий предикат видимости капсулы для ОБОИХ хостов (plate/list).
// hasVisibleRu и windowOk вычисляет вызывающий (они разные для plate и list),
// сюда приходят готовыми bool — так предикат остаётся чистым и тестируемым.
//  - пустой/пробельный text_en → нечего переводить/хэшировать (edge 1);
//  - RU этой строки уже показан → раскрывать нечего;
//  - вырожденное окно перевода (windowForIndices===null) → нечего переводить
//    (для list вызывающий передаёт windowOk:true — там вырожденность не гейтит).
export function capsuleVisible(args: { textEn: string; hasVisibleRu: boolean; windowOk: boolean }): boolean {
  if (!args.textEn.trim()) return false
  if (args.hasVisibleRu) return false
  if (!args.windowOk) return false
  return true
}

// shouldReveal — добавлять ли ЗАХВАЧЕННЫЙ индекс в revealedByIndex на резолве ok.
// ⚠️ Условие = matched[i] присутствует ИЛИ у cue есть корпусный text_ru — НЕ
// «matched непуст» (SPEC §2.1): иная сегментация шлюза может вернуть matched без
// нажатого индекса (краем задело соседа), и тогда безусловное раскрытие дало бы
// ВИДИМУЮ ПУСТУЮ RU-плашку (ru='' в l2). truthy-гард на matched[i]: пустой RU не раскрываем.
export function shouldReveal(matched: Record<number, string>, capturedIndex: number, cueTextRu: string): boolean {
  return !!matched[capturedIndex] || !!cueTextRu
}

// buildLineRevealPayload — строитель тела события subtitle_line_reveal (SPEC §5).
// Чистый: cue/mode/surface/result приходят ЗАХВАЧЕННЫМИ на клике (не «текущими»).
// ⚠️ sub_line_hash — от text_en ЗАХВАЧЕННОГО cue (join с rewind/ab_loop), НЕ от RU.
// ⚠️ timecode — round2(cue.start) захваченного cue, НЕ currentTime плеера (в list
//    можно кликнуть не-активную строку → currentTime указал бы на другую реплику).
export function buildLineRevealPayload(args: {
  videoId: string
  routeGoal?: string
  cue: { start: number; text_en: string }
  mode: 'l2' | 'l2l1' | 'hidden'
  surface: RevealSurface
  result: RevealResult
}): Record<string, unknown> {
  return {
    video_id: args.videoId,
    route_goal: args.routeGoal,
    sub_line_hash: subLineHash(args.cue.text_en),
    timecode: round2(args.cue.start),
    surface: args.surface,
    mode: args.mode,
    result: args.result,
  }
}
