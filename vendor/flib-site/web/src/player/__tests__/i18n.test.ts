// i18n.test.ts — фундамент многоязычности плеера (T1).
// Стор — глобальный module-state (useSyncExternalStore), поэтому каждый тест,
// меняющий локаль, обязан вернуть её в 'ru' в afterEach (изоляция внутри файла).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { ru, en, setLocale, getLocale, tl } from '../i18n'

afterEach(() => {
  setLocale('ru')
  try { localStorage.clear() } catch { /* noop */ }
})

describe('i18n — словари ru/en', () => {
  it('множества ключей ru и en идентичны (симметрия)', () => {
    const rk = Object.keys(ru).sort()
    const ek = Object.keys(en).sort()
    expect(ek).toEqual(rk)
  })

  it('содержит 3 ключа режимов субтитров, 17 ключей workspace, 19 ключей ShadowCard (T4+CSP-хотфикс audio_init+визуальный фикс/accept#1: shadowExpected/shadowSpeak/shadowAnalyzing+shadowWaiting/shadowLoop), 4 ключа T5 customText-меню (shadowSetCustomText/shadowClearCustomText/shadowCustomTextPlaceholder/shadowCustomTextSave), 5 ключей T7c B1-нотации (shadowVerdictAdded/shadowVerdictMisheard/shadowVerdictUnknown/shadowVerdictNoResponse/shadowVerdictError), 1 ключ T7-fix (5-timeout: shadowVerdictNoAnswer), 5 ключей T9 bind-панели (shadowBindLbl/shadowBindOff/shadowBindSub/shadowBindNow/shadowDragHint), 7 ключей среза B settingsRow+custom-режим (shadowAuto/shadowModeSubtitle/shadowModeCustom/shadowFromSub/shadowCustomPlaceholder/shadowOcr/shadowFile) и 3 ключа ТЗ №2 quota-ux баннера (shadowUnavailQuota/shadowUnavailQuotaReset/shadowUnavailService) + 1 ключ ТЗ №3 (shadowEarlier) + 3 ключа перевода субтитров (translateLabel/translateLabelPlural/translateBlock, [ID:P-subtitle-translate]) + 1 ключ капсулы перевода строки (translateLine, [ID:P-subtitle-translate-capsule]), итого 69', () => {
    expect(Object.keys(ru)).toHaveLength(69)
    for (const k of ['player.subtitleEn', 'player.subtitleEnRu', 'player.subtitleOff']) {
      expect(ru[k]).toBeTruthy()
      expect(en[k]).toBeTruthy()
    }
  })

  it('owner-требование: subtitleOff = Скрыть (ru) / Hide (en, намеренное отклонение от десктопного Off)', () => {
    expect(ru['player.subtitleOff']).toBe('Скрыть')
    expect(en['player.subtitleOff']).toBe('Hide')
  })

  it('ru-значения 17 workspace-ключей вербатим из i18n-mini (а не из десктопного ru.ts)', () => {
    expect(ru['player.prevCue']).toBe('Предыдущая реплика')       // НЕ 'Предыдущая фраза'
    expect(ru['player.puzzleHint']).toBe('Пазлы (тренировка)')    // НЕ 'Пазлы — собрать фразу из слов'
    expect(ru['player.waveformModeViewLinear']).toBe('Волна: линейн.') // НЕ 'по окну'
  })
})

describe('i18n — translate / tl / fallback / интерполяция', () => {
  it('tl отдаёт значение текущей локали', () => {
    expect(getLocale()).toBe('ru')
    expect(tl('player.play')).toBe('Воспроизвести')
    setLocale('en')
    expect(tl('player.play')).toBe('Play')
  })

  it('неизвестный ключ возвращает сам ключ (никогда undefined)', () => {
    expect(tl('player.doesNotExist')).toBe('player.doesNotExist')
  })

  it('интерполяция {param} (несколько вхождений через split/join)', () => {
    // waveformHint содержит одно {mode}; проверяем и кастомный multi-вхождение через реальный ключ
    expect(tl('player.waveformHint', { mode: 'дБ' })).toContain('дБ')
  })

  it('setLocale с тем же значением — no-op (getLocale стабилен)', () => {
    setLocale('ru')
    expect(getLocale()).toBe('ru')
  })
})

describe('i18n — персист и валидация flib:locale', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* noop */ } })

  it('setLocale пишет flib:locale и обновляет document.documentElement.lang', () => {
    setLocale('en')
    expect(localStorage.getItem('flib:locale')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('мусорное flib:locale игнорируется при загрузке модуля → дефолт ru', async () => {
    // модуль читает localStorage один раз при импорте; проверяем loadLocale через свежий импорт
    localStorage.setItem('flib:locale', 'klingon')
    const mod = await import(`../i18n?bust=${Date.now()}`)
    expect(mod.getLocale()).toBe('ru')
  })

  // [Добавлено фактчеком, 2026-07-05 — edge case 9] Без этого теста init-sync баг не ловится:
  // T1.1's предыдущий тест на lang всегда стартует из дефолтного 'ru' (setLocale('en') оттуда —
  // реальная смена, не no-op), поэтому не проверяет случай персистентной non-ru локали при загрузке.
  it('персистентная non-ru локаль синхронизирует <html lang> СРАЗУ при загрузке модуля (без setLocale)', async () => {
    localStorage.setItem('flib:locale', 'en')
    const mod = await import(`../i18n?bust=${Date.now()}`)
    expect(mod.getLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
