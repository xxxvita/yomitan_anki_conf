// generate.ts — генератор фикстур событий сайта для теста шлюза Г3 (спека
// §11 «Г3 — точная постановка», план B8a).
//
// Каждое событие собрано НАСТОЯЩИМ кодом сопоставления (mapper.ts, clip-played.ts,
// счётчик субтитров приложения) — тем же, что зовут плеер (B8c), страница дня
// (B10b), `VideoVoteBar` (B9) и страница урока (B10f). Полей ожиданий в файле
// нет: ожидания держит тест шлюза (H1), иначе генератор проверял бы сам себя.
//
// Формат: `{v:1, site_commit, cases:[{name, kind, event}]}`; каждое `event` —
// компактный JSON (деградированный clip_played близок к потолку, отступы не
// должны его переступить). Обязательные 17 имён — REQUIRED_CASES; сверх них —
// дополнительные случаи (шлюз проверяет их общими правилами).
//
// Обновить файл: `UPDATE_SITE_FIXTURES=1 SITE_COMMIT=<sha> npx vitest run site-events`.
import { завестиСчётчик, шаг, ключСнимка, type Реплика, type Счётчик } from '../subtitle-counter'
import { buildClipPlayed, wordsLessonClipPlayed, type ProgressInfo } from '../clip-played'
import {
  clipRatedEvent, clipReplayedEvent, clipboardCopyEvent, hintRequestedEvent, lineTranslatedEvent,
  subsSourceOf, subtitlesShownEvent, type Envelope, type SiteEvent,
} from '../mapper'
import { MAX_HEARD_PER_REPORT } from '../../../site/cabinet/route/line-credit'
import { shortClipPlayed } from '../../../site/cabinet/route/outbox'

export const REQUIRED_CASES = [
  'clip_played/absent', 'clip_played/empty', 'clip_played/full', 'clip_played/full_restored',
  'clip_played/partial', 'clip_played/degraded_partial', 'clip_played/degraded_empty',
  'clip_played/words_lesson',
  'subtitles_shown/word', 'subtitles_shown/line', 'hint_requested/word', 'line_translated/line',
  'clip_replayed/seek_back', 'clipboard_copy/selection',
  'clip_rated/like', 'clip_rated/dislike_reason', 'clip_rated/dislike_reason_player',
] as const

export interface FixtureCase { name: string; kind: string; event: SiteEvent }
export interface FixtureFile { v: 1; site_commit: string; cases: FixtureCase[] }

const DAY = '2026-11-18'
const PID = 'youtube::dQw4w9WgXcQ'

let seq = 0
function env(): Envelope {
  seq++
  const n = String(seq).padStart(12, '0')
  return { event_id: `web:00000000-0000-4000-8000-${n}`, learning_day: DAY, client_ts: `2026-11-18T10:${String(seq).padStart(2, '0')}:00Z` }
}

const CUES: Реплика[] = [
  { start: 0, end: 2.4, text: '[Music]' },
  { start: 2.4, end: 5.1, text: 'Hey, are you coming tonight?' },
  { start: 5.1, end: 8.0, text: "I don't know, maybe later." },
  { start: 8.0, end: 11.5, text: 'We could grab something to eat first.' },
  { start: 11.5, end: 14.2, text: 'That sounds like a plan!' },
]
const snapOf = (cues: Реплика[]) => ({ puzzleID: PID, ключ: ключСнимка(cues), реплики: cues })

function play(c: Счётчик, from: number, to: number): Счётчик {
  let x = c
  for (let t = from; t <= to + 1e-9; t += 0.25) x = шаг(x, { время: t, сдвиг: 0, идётПеремотка: false, ставка: 1 })
  return x
}

// big — счётчик длинного ролика (тысячи реплик): флаги «услышано» ставятся
// прямо, упаковка — настоящая (собратьОтчёт + buildClipPlayed).
function big(heardN: number, unheardN: number): Счётчик {
  const cues: Реплика[] = Array.from({ length: heardN + unheardN }, (_, i) => ({
    start: i * 2, end: i * 2 + 1.5,
    text: Array.from({ length: 14 }, (_, k) => `word${(i * 7 + k) % 997}x`).join(' '),
  }))
  const c = завестиСчётчик(snapOf(cues))
  const mark = (i: number) => (i < heardN ? 1 : 0)
  return { ...c, услышано: cues.map((_, i) => mark(i)), возвраты: cues.map((_, i) => mark(i)), минСтавка: cues.map((_, i) => mark(i)) }
}

const NOT_FOUND: ProgressInfo = { kind: 'not_found', heardMax: 0 }
const SOURCE = subsSourceOf('daemon_align')

function clip(name: string, counter: Счётчик | null, o: { resolved?: boolean; frac: number; progress: ProgressInfo | null }): FixtureCase {
  const { event } = buildClipPlayed({ puzzleId: PID, counter, trackResolved: o.resolved ?? true, frac: o.frac, progress: o.progress, subsSource: SOURCE }, env())
  return { name, kind: 'clip_played', event }
}

function must(name: string, e: SiteEvent | null): FixtureCase {
  if (!e) throw new Error(`генератор: событие ${name} не собралось`)
  return { name, kind: e.type, event: e }
}

export function buildSiteEventFixtures(siteCommit: string): FixtureFile {
  seq = 0
  const heardThree = play(завестиСчётчик(snapOf(CUES)), 0, 11.6)
  const cases: FixtureCase[] = [
    clip('clip_played/absent', null, { frac: 0.92, progress: NOT_FOUND }),
    clip('clip_played/empty', play(завестиСчётчик(snapOf(CUES)), 0, 1.5), { frac: 0.083, progress: NOT_FOUND }),
    clip('clip_played/full', heardThree, { frac: 0.8, progress: NOT_FOUND }),
    clip('clip_played/full_restored', heardThree, { frac: 0.8, progress: { kind: 'restored', heardMax: 3 } }),
    clip('clip_played/partial', heardThree, { frac: 0.8, progress: { kind: 'failed', heardMax: 0 } }),
    clip('clip_played/degraded_partial', big(1000, 2000), { frac: 0.66, progress: NOT_FOUND }),
    clip('clip_played/degraded_empty', big(1000, 4500), { frac: 0.71, progress: NOT_FOUND }),
    { name: 'clip_played/words_lesson', kind: 'clip_played', event: wordsLessonClipPlayed('words::0123456789abcdef', 0.6, env()) },
    must('subtitles_shown/word', subtitlesShownEvent(PID, 2, ['know'], env())),
    must('subtitles_shown/line', subtitlesShownEvent(PID, 3, ['We', 'could', 'grab', 'something'], env())),
    must('hint_requested/word', hintRequestedEvent(PID, 'grab', env())),
    must('line_translated/line', lineTranslatedEvent(PID, CUES[3].text, env())),
    must('clip_replayed/seek_back', clipReplayedEvent(PID, CUES[2].text, env())),
    must('clipboard_copy/selection', clipboardCopyEvent(PID, 'sounds like a plan', { fromL1: false }, env())),
    must('clip_rated/like', clipRatedEvent(PID, { rating: 'like', subsSource: '' }, env())),
    must('clip_rated/dislike_reason', clipRatedEvent(PID, { rating: 'dislike', reason: 'subs_misaligned', subsSource: '' }, env())),
    must('clip_rated/dislike_reason_player', clipRatedEvent(PID, { rating: 'dislike', reason: 'content', subsSource: SOURCE }, env())),
    // Дополнительные случаи: общие правила шлюза (пп. 3, 6 теста Г3).
    clip('clip_played/heard_cap', big(MAX_HEARD_PER_REPORT + 1, 0), { frac: 0.95, progress: NOT_FOUND }),
    clip('clip_played/track_pending', null, { resolved: false, frac: 0.3, progress: { kind: 'failed', heardMax: 0 } }),
    must('clipboard_copy/l1', clipboardCopyEvent(PID, 'Звучит как план', { fromL1: true, enLine: CUES[4].text }, env())),
    must('clip_rated/like_player', clipRatedEvent(PID, { rating: 'like', subsSource: subsSourceOf(null) }, env())),
  ]
  // Короткая форма отчёта для keepalive на выгрузке страницы (ревью партии 2, C2):
  // полный отчёт не помещается в 60 КиБ — уходит partial + played_frac без массивов.
  const full = cases.find(c => c.name === 'clip_played/degraded_partial')!
  const short = shortClipPlayed({ route_id: 'r', event: full.event, frac: 0.66 })
  cases.push(must('clip_played/keepalive_short', short as SiteEvent | null))
  return { v: 1, site_commit: siteCommit, cases }
}

// serializeFixtures — побайтный формат файла: события компактные.
export function serializeFixtures(f: FixtureFile): string {
  return `{\n  "v": 1,\n  "site_commit": ${JSON.stringify(f.site_commit)},\n  "cases": [\n`
    + f.cases.map(c => `    ${JSON.stringify(c)}`).join(',\n')
    + '\n  ]\n}\n'
}
