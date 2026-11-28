// web/src/player/i18n.ts
// WEB-SEAM (T1, спринт i18n-foundation): порт десктопной i18n-архитектуры
// (anki_conf/electron/renderer/i18n/index.ts) БЕЗ zustand — в вебе zustand не
// установлен, поэтому стор построен на встроенном useSyncExternalStore с
// собственным emitter'ом. Дефолт локали 'ru' (не ломает 13 getByTitle-тестов, было
// ошибочно указано 12 — исправлено фактчеком, см. раздел «Инвариант» выше).
// Персист по конвенции flib:* → 'flib:locale'.
//
// Словари первого среза (20 ключей):
//   • 3 ключа режимов субтитров — player.subtitleEn / player.subtitleEnRu / player.subtitleOff
//   • 17 ключей workspace — портированы из workspace/i18n-mini.ts (ru ВЕРБАТИМ оттуда, чтобы
//     не сломать getByTitle-тесты; они расходятся с десктопным ru.ts). en взят с десктопа en.ts.
import { useSyncExternalStore } from 'react'

export type Locale = 'ru' | 'en'

const LOCALE_KEY = 'flib:locale'

// ── Словари ────────────────────────────────────────────────────────────────
// ru: 17 workspace-ключей ВЕРБАТИМ из i18n-mini.ts + 3 subtitle-ключа.
export const ru: Record<string, string> = {
  // режимы субтитров (labelKey для SUBTITLE_MODE_OPTIONS)
  'player.subtitleEn': 'EN',
  'player.subtitleEnRu': 'EN + RU',
  'player.subtitleOff': 'Скрыть', // owner: Off → Скрыть (ru)
  // workspace (вербатим из i18n-mini.ts)
  'player.waveformModeViewLinear': 'Волна: линейн.',
  'player.waveformModeViewDb': 'Волна: дБ',
  'player.waveformModeClipLinear': 'Волна: клип',
  'player.waveformHint': 'Режим волны: {mode}',
  'player.prevCue': 'Предыдущая реплика',
  'player.nextCue': 'Следующая реплика',
  'player.rewind5': '−5 с',
  'player.forward5': '+5 с',
  'player.play': 'Воспроизвести',
  'player.pause': 'Пауза',
  'player.shadowLabel': 'Шадоуинг',
  'player.translateLabel': 'Перевести',
  'player.translateLabelPlural': 'Перевести блоки субтитров',
  'player.translateBlock': 'Перевести блок',
  'player.translateLine': 'Перевести эту строку',
  'player.dictationLabel': 'Диктант',
  'player.puzzleHint': 'Пазлы (тренировка)',
  'player.puzzleLabel': 'Пазлы',
  'player.loopOn': 'A-B повтор: вкл',
  'player.loopOff': 'A-B повтор: выкл',
  'player.exitLabel': 'Закрыть',
  // ShadowCard (T4) — новые ключи, авторские (нет эквивалента в player.* на десктопе,
  // кроме player.shadowLabel — уже выше в списке).
  'player.shadowRecord': 'Записать',
  'player.shadowStop': 'Стоп',
  'player.shadowTranscribing': 'Распознаю…',
  'player.shadowClose': 'Закрыть шадоуинг',
  'player.shadowAgain': 'Ещё раз',
  'player.shadowHeard': 'услышано',
  'player.shadowNoCue': 'Наведите курсор на реплику и нажмите запись',
  'player.shadowCapped': 'Достигнут лимит 60с — остановлено',
  'player.shadowErr.mic_denied': 'Нет доступа к микрофону',
  'player.shadowErr.too_large': 'Запись слишком длинная',
  'player.shadowErr.rate_limited': 'Слишком часто — подождите пару секунд',
  'player.shadowErr.gateway': 'Ошибка распознавания, попробуйте ещё раз',
  'player.shadowErr.no_speech': 'Речь не распознана',
  // CSP-хотфикс (fix/shadow-worklet-csp): AudioWorklet-инициализация упала
  // ПОСЛЕ успешного getUserMedia — отдельно от mic_denied.
  'player.shadowErr.audio_init': 'Не удалось инициализировать аудио — обновите страницу или сообщите нам',
  // ShadowCardLifted (визуальный фикс, приёмка №1) — 3 новых ключа рек-строки/
  // target-панели, порт desktop makeStrings() (ShadowChat.tsx:78-83).
  'player.shadowExpected': 'ОЖИДАЕТСЯ',
  'player.shadowSpeak': 'Говорите',
  'player.shadowAnalyzing': 'Анализ',
  // ShadowCardLifted review-acceptance #1 fix pass — dashed-block placeholder
  // + attempts-feed "Loop N" label, verbatim values of desktop makeStrings()
  // T.listening/T.loop (ShadowChat.tsx:94/82).
  'player.shadowWaiting': 'Жду Ваш ответ…',
  'player.shadowLoop': 'повтор',
  // ТЗ №3 п.2 — collapsed older attempts line ("+K ранних").
  'player.shadowEarlier': '+{count} ранних',
  // Срез B — settingsRow (mode toggle / АВТОПЕРЕХОД) + custom-режим targetPanel,
  // порт desktop makeStrings() (ShadowChat.tsx :82-89).
  'player.shadowAuto': 'Автопереход',
  'player.shadowModeSubtitle': 'Субтитр',
  'player.shadowModeCustom': 'Свой текст',
  'player.shadowFromSub': 'Вставить из текущего субтитра',
  'player.shadowCustomPlaceholder': 'Введите фразу для повторения…',
  'player.shadowOcr': 'Снимок кадра + OCR',
  'player.shadowFile': 'Файл с текстом',
  // T5 (D1) — right-click context menu "customText" (владелец: не отдельное
  // поле, right-click → меню, всегда доступно, текст важнее субтитра).
  'player.shadowSetCustomText': 'Задать значение текста',
  'player.shadowClearCustomText': 'Очистить текст',
  'player.shadowCustomTextPlaceholder': 'Введите текст для отработки…',
  'player.shadowCustomTextSave': 'Сохранить',
  // T7c — B1 нотация: 3 диагноза для лишних слов + не-final verdict-исходы.
  'player.shadowVerdictAdded': 'Вы добавили',
  'player.shadowVerdictMisheard': 'возможно, ослышались',
  'player.shadowVerdictUnknown': '?',
  'player.shadowVerdictNoResponse': 'Мы Вас не услышали',
  'player.shadowVerdictError': 'Не удалось разобрать ответ',
  // T7-fix (5-timeout, MED CONFIRMED) — a `timeout` outcome without any
  // partial text (or a `final` outcome against an empty target snapshot)
  // must never leave the verdict slot as an empty/blank line. Third
  // "не знаем" diagnosis, distinct from no-response/error.
  'player.shadowVerdictNoAnswer': 'Нет ответа',
  // T9 — bind-panel "ПРИВЯЗКА" (lift ShadowChat.tsx :951-998 bindRowFull),
  // verbatim values of desktop makeStrings() T.bindLbl/bindOff/bindSub/
  // bindNow/dragHint (ShadowChat.tsx :90-93).
  'player.shadowBindLbl': 'привязка',
  'player.shadowBindOff': 'выкл',
  'player.shadowBindSub': 'к субтитру',
  'player.shadowBindNow': 'сейчас',
  'player.shadowDragHint': 'Перетащите на дорожку упражнений',
  // ТЗ №2 [ID:P-hotfix-quota-ux] — баннер недоступности источника распознавания
  // (quota_exhausted / временная недоступность). {date} подставляется из resetsAt.
  'player.shadowUnavailQuota': 'Лимит работы с Shadowing в этом месяце достиг предела. Для продолжения использования приобретите дополнительные квоты.',
  'player.shadowUnavailQuotaReset': 'Лимит обновится {date}',
  'player.shadowUnavailService': 'Сервис распознавания речи временно недоступен. Попробуйте позже.',
}

// en: значения взяты с десктопа electron/renderer/i18n/en.ts, КРОМЕ
// player.subtitleOff — десктоп даёт 'Off', владелец требует 'Hide' (намеренное отклонение).
export const en: Record<string, string> = {
  // режимы субтитров
  'player.subtitleEn': 'EN',
  'player.subtitleEnRu': 'EN + RU',
  'player.subtitleOff': 'Hide', // owner: НАМЕРЕННОЕ отклонение от десктопного en 'Off'
  // workspace (десктоп en.ts)
  'player.waveformModeViewLinear': 'by window',        // en.ts:1478
  'player.waveformModeViewDb': 'by window · dB',        // en.ts:1479
  'player.waveformModeClipLinear': 'by clip',           // en.ts:1480
  'player.waveformHint': 'Right-click: waveform view (now: {mode})', // en.ts:1481
  'player.prevCue': 'Previous cue',                     // en.ts:1428
  'player.nextCue': 'Next cue',                         // en.ts:1429
  'player.rewind5': '−5s',                              // en.ts:1476
  'player.forward5': '+5s',                             // en.ts:1477
  'player.play': 'Play',                                // en.ts:1433
  'player.pause': 'Pause',                              // en.ts:1434
  'player.shadowLabel': 'Shadow',                       // en.ts:1435
  'player.translateLabel': 'Translate',
  'player.translateLabelPlural': 'Translate subtitle blocks',
  'player.translateBlock': 'Translate block',
  'player.translateLine': 'Translate this line',
  'player.dictationLabel': 'Dictation',                 // en.ts:1436
  'player.puzzleHint': 'Puzzle — assemble the phrase from word chips', // en.ts:1438
  'player.puzzleLabel': 'Puzzle',                       // en.ts:1437
  'player.loopOn': 'A-B loop: on',                      // en.ts:1440
  'player.loopOff': 'A-B loop: off',                    // en.ts:1441
  'player.exitLabel': 'Close',                          // en.ts:1439
  // ShadowCard (T4) — new keys, authored (no desktop player.* equivalent besides
  // player.shadowLabel, already above).
  'player.shadowRecord': 'Record',
  'player.shadowStop': 'Stop',
  'player.shadowTranscribing': 'Transcribing…',
  'player.shadowClose': 'Close shadowing',
  'player.shadowAgain': 'Again',
  'player.shadowHeard': 'heard',
  'player.shadowNoCue': 'Hover a cue and press record',
  'player.shadowCapped': '60s limit reached — stopped',
  'player.shadowErr.mic_denied': 'Microphone access denied',
  'player.shadowErr.too_large': 'Recording too long',
  'player.shadowErr.rate_limited': 'Too frequent — wait a couple seconds',
  'player.shadowErr.gateway': 'Recognition error, try again',
  'player.shadowErr.no_speech': 'No speech recognized',
  // ShadowCardLifted (visual fix, accept #1) — 3 new keys, desktop makeStrings() port (ShadowChat.tsx:97-101).
  'player.shadowExpected': 'EXPECTED',
  'player.shadowSpeak': 'Speak',
  'player.shadowAnalyzing': 'Analyzing…',
  // CSP hotfix (fix/shadow-worklet-csp): AudioWorklet init failed AFTER
  // getUserMedia already succeeded — distinct from mic_denied.
  'player.shadowErr.audio_init': 'Audio init failed — refresh or report',
  // ShadowCardLifted review-acceptance #1 fix pass — verbatim desktop
  // makeStrings() T.listening/T.loop (ShadowChat.tsx:113/101).
  'player.shadowWaiting': 'Listening…',
  'player.shadowLoop': 'loop',
  'player.shadowEarlier': '+{count} earlier',
  // Срез B — settingsRow + custom-mode targetPanel, desktop makeStrings() port
  // (ShadowChat.tsx :101-108).
  'player.shadowAuto': 'Auto-advance',
  'player.shadowModeSubtitle': 'Subtitle',
  'player.shadowModeCustom': 'Custom',
  'player.shadowFromSub': 'Insert from current subtitle',
  'player.shadowCustomPlaceholder': 'Type the phrase to shadow…',
  'player.shadowOcr': 'Frame snapshot + OCR',
  'player.shadowFile': 'Text file',
  // T5 (D1) — right-click context menu "customText".
  'player.shadowSetCustomText': 'Set custom text',
  'player.shadowClearCustomText': 'Clear text',
  'player.shadowCustomTextPlaceholder': 'Enter text to practice…',
  'player.shadowCustomTextSave': 'Save',
  // T7c — B1 notation: 3 diagnoses for extra words + non-final verdict outcomes.
  'player.shadowVerdictAdded': 'you added',
  'player.shadowVerdictMisheard': 'possibly misheard',
  'player.shadowVerdictUnknown': '?',
  'player.shadowVerdictNoResponse': "We didn't hear you",
  'player.shadowVerdictError': "Couldn't parse the answer",
  // T7-fix (5-timeout, MED CONFIRMED) — see ru dict comment.
  'player.shadowVerdictNoAnswer': 'No answer',
  // T9 — bind-panel "ПРИВЯЗКА", verbatim values of desktop makeStrings()
  // T.bindLbl/bindOff/bindSub/bindNow/dragHint (ShadowChat.tsx :109-112).
  'player.shadowBindLbl': 'bind',
  'player.shadowBindOff': 'off',
  'player.shadowBindSub': 'to subtitle',
  'player.shadowBindNow': 'to time',
  'player.shadowDragHint': 'Drag to exercise track',
  // ТЗ №2 [ID:P-hotfix-quota-ux] — recognition-source unavailable banner.
  'player.shadowUnavailQuota': "You've reached this month's Shadowing usage limit. Purchase additional quota to keep going.",
  'player.shadowUnavailQuotaReset': 'Limit resets {date}',
  'player.shadowUnavailService': 'Speech recognition service is temporarily unavailable. Please try again later.',
}

const DICTS: Record<Locale, Record<string, string>> = { ru, en }

// ── Стор на useSyncExternalStore ────────────────────────────────────────────
function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_KEY)
    if (raw === 'ru' || raw === 'en') return raw
  } catch { /* storage unavailable — fall back to default */ }
  return 'ru'
}

let currentLocale: Locale = loadLocale()
// [BLOCKER-фикс, добавлено фактчеком 2026-07-05]: index.html жёстко задаёт lang="ru";
// без этой строки восстановленная из flib:locale non-ru локаль оставляет <html lang>
// рассинхронизированным до первого РЕАЛЬНОГО переключения (setLocale — no-op на уже
// активной локали, см. edge case 9), т.е. потенциально навсегда для персистентного 'en'.
try { document.documentElement.lang = currentLocale } catch { /* non-DOM env */ }
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot(): Locale {
  return currentLocale
}

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return // no-op: не будим слушателей зря
  currentLocale = next
  try { localStorage.setItem(LOCALE_KEY, next) } catch { /* quota/denied — just won't persist */ }
  try { document.documentElement.lang = next } catch { /* non-DOM env */ }
  listeners.forEach(fn => fn())
}

export function useLocale(): Locale {
  // getServerSnapshot === getSnapshot: SSR-safe, отдаёт то же значение
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ── translate / хуки ─────────────────────────────────────────────────────────
function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = DICTS[locale]?.[key] ?? DICTS.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v)) // split/join: заменяет ВСЕ вхождения
    }
  }
  return text
}

/**
 * Хук-переводчик: подписывается на локаль (ре-рендер при setLocale).
 * Совместим по сигнатуре с прежним i18n-mini useT — (key, params?) => string.
 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const locale = useLocale()
  return (key, params) => translate(locale, key, params)
}

/**
 * Не-хук переводчик для .ts-утилит вне React. Читает ТЕКУЩУЮ локаль
 * (нереактивно) — корректно, когда результат потребляется в рендере,
 * который и так ре-рендерится на смене локали.
 */
export function tl(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale, key, params)
}
