// start-model.test.ts — чистая логика экрана старта v2 и экрана подбора
// (дизайн 2026-11-19 §3a/§3b).
import { describe, it, expect } from 'vitest'
import { imdbUrl, isStartLevel, levelSummary, NEED_GOAL_PROMPT, minutesLeftLabel, pickProgress, pickStep, START_LEVELS, whyTexts, ytThumb, SHOW_CATALOG, catalogOn, quickStartErrorText, toggleTitleRef, totalLabel, typeLabel } from '../start-model'

describe('уровни и подписи', () => {
  it('пять уровней A1…C1 с утверждёнными текстами, без C2', () => {
    expect(START_LEVELS.map(l => l.id)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
    expect(START_LEVELS[1]).toEqual({ id: 'A2', name: 'базовый', text: 'Известные фразы Вы узнаёте в речи, но общий смысл улавливаете с трудом.' })
    expect(isStartLevel('C2')).toBe(false)
    expect(isStartLevel('B1')).toBe(true)
    expect(isStartLevel(undefined)).toBe(false)
  })
  it('подпись цели: A1 своя, A2/B1/B2 общая, C1 — два абзаца', () => {
    expect(whyTexts('A1')[0]).toMatch(/^Начните с чего-то простого/)
    for (const l of ['A2', 'B1', 'B2'] as const) expect(whyTexts(l)).toEqual(['Выбирайте свою цель, к которой Вы пойдёте через наши рекомендации и станете свободно понимать её на слух'])
    expect(whyTexts('C1')).toHaveLength(2)
    expect(whyTexts('C1')[0]).toMatch(/^Для Вас может быть полезен раздел ниже/)
    expect(whyTexts('C1')[1]).toMatch(/^Фильмы и сериалы на любой вкус/)
  })
  // Решение владельца 2026-11-19: маршрута без цели нет — «маршрут построится по уровню» убрано.
  it('сводка уровня — без обещания маршрута по уровню; подсказка выбора цели', () => {
    expect(levelSummary('A2')).toBe('A2 · базовый')
    expect(levelSummary('C1')).toBe('C1 · продвинутый')
    expect(NEED_GOAL_PROMPT).toBe('Выберите хотя бы одну цель')
  })
  it('ссылки: IMDb и превью YouTube', () => {
    expect(imdbUrl('tt0108778')).toBe('https://www.imdb.com/title/tt0108778/')
    expect(ytThumb('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
  })
  it('каталог источников включён в сборке (S7a); показ решает сервер', () => {
    expect(SHOW_CATALOG).toBe(true)
  })
})

describe('экран подбора', () => {
  it('процент по времени против 2 минут, до готовности не больше 95', () => {
    expect(pickProgress(0)).toEqual({ pct: 0, minutesLeft: 2 })
    expect(pickProgress(60_000)).toEqual({ pct: 50, minutesLeft: 1 })
    expect(pickProgress(1.9 * 60_000).pct).toBe(95)
    expect(pickProgress(2 * 60_000)).toEqual({ pct: 95, minutesLeft: 1 })
    expect(pickProgress(30 * 60_000)).toEqual({ pct: 95, minutesLeft: 1 })
  })
  it('после оценки полоса стоит на 95 %, текст — «осталось около 1 минуты»', () => {
    const p = pickProgress(5 * 60_000)
    expect(p.pct).toBe(95)
    expect(minutesLeftLabel(p.minutesLeft)).toBe('осталось около 1 минуты')
  })
  it('остаток округляется вверх, не меньше минуты; отрицательное/NaN — как 0', () => {
    expect(pickProgress(1_000).minutesLeft).toBe(2)
    expect(pickProgress(60_000 + 1).minutesLeft).toBe(1)
    expect(pickProgress(-5000)).toEqual({ pct: 0, minutesLeft: 2 })
    expect(pickProgress(Number.NaN)).toEqual({ pct: 0, minutesLeft: 2 })
  })
  it('«осталось около N минут» — родительный падеж', () => {
    expect(minutesLeftLabel(1)).toBe('осталось около 1 минуты')
    expect(minutesLeftLabel(2)).toBe('осталось около 2 минут')
    expect(minutesLeftLabel(5)).toBe('осталось около 5 минут')
    expect(minutesLeftLabel(21)).toBe('осталось около 21 минуты')
  })
  it('шаг по статусу задания: нет — 1, waiting — 2, claimed/processing — 3, done — 4', () => {
    expect(pickStep(null)).toBe(0)
    expect(pickStep(undefined)).toBe(0)
    expect(pickStep('waiting')).toBe(1)
    expect(pickStep('claimed')).toBe(2)
    expect(pickStep('processing')).toBe(2)
    expect(pickStep('done')).toBe(3)
    expect(pickStep('weird')).toBe(0)
  })
})

describe('каталог тайтлов (S5)', () => {
  it('catalogOn: нужны И сборка, И поле сессии (сборка включена — итог задаёт сессия)', () => {
    expect(catalogOn(true)).toBe(SHOW_CATALOG)
    expect(catalogOn(false)).toBe(false)
    // настоящая функция: включена только пара «сборка И сессия» (M-1, откат S7 через сессию)
    expect(catalogOn(true, true)).toBe(true)
    expect(catalogOn(false, true)).toBe(false)
    expect(catalogOn(true, false)).toBe(false)
    expect(catalogOn(false, false)).toBe(false)
  })
  it('тексты отказов быстрого старта — дословно спека §7.3 (Р-В14)', () => {
    expect(quickStartErrorText('goal_title_unknown', null)).toBe('Этого материала больше нет в каталоге — уберите его из цели')
    expect(quickStartErrorText('goal_title_unavailable', null)).toBe('Этот материал пока нельзя выбрать целью — уберите его из цели')
    expect(quickStartErrorText('goal_target_invalid', null)).toBe('Страница устарела. Обновите её и выберите цель заново')
    expect(quickStartErrorText('catalog_unavailable', null)).toBe('Каталог временно недоступен. Попробуйте через минуту.')
    expect(quickStartErrorText('too_many_goals', { field: 'goal.titles' })).toBe('Можно выбрать до 10 целей')
    expect(quickStartErrorText('too_many_goals', { field: 'goal' })).toBe('Можно выбрать до 20 целей вместе с роликами')
    expect(quickStartErrorText('goal_empty', null)).toBeNull()
    expect(quickStartErrorText(null, null)).toBeNull()
  })
  it('L-9: toggleTitleRef — 11-й не добавляется, снятие работает, исходный список не меняется', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ slug: `t${i}`, title: `T${i}` }))
    expect(toggleTitleRef(ten, { slug: 'x', title: 'X' }, 10)).toEqual(ten)
    expect(toggleTitleRef(ten, { slug: 't3', title: 'T3' }, 10)).toHaveLength(9)
    expect(toggleTitleRef(ten.slice(0, 9), { slug: 'x', title: 'X' }, 10)).toHaveLength(10)
    expect(ten).toHaveLength(10)
  })
  it('подписи: тип и «N в каталоге»', () => {
    expect([typeLabel('series'), typeLabel('film'), typeLabel('cartoon'), typeLabel('x')]).toEqual(['Сериал', 'Фильм', 'Мультфильм', ''])
    expect(totalLabel(6312)).toBe('6\u00a0312 в каталоге')
    expect(totalLabel(5)).toBe('5 в каталоге')
    expect(totalLabel(-3)).toBe('0 в каталоге')
  })
})
