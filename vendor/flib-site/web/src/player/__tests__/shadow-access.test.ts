// shadow-access.test.ts — Э6, Shadowing UI-гейт: дефолт ЗАПРЕЩЁН (владелец:
// "не всем"), доступ только когда flib:access.shadowing === true.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hasShadowingAccess, shadowLockedTitle, SHADOW_LOCKED_LEGACY, SHADOW_LOCKED_NOT_IN_KEY, SHADOW_LOCKED_LOGIN, SHADOW_LOCKED_EXPIRED, SHADOW_LOCKED_UNAVAILABLE } from '../shadow-access'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'

// Подсказка запертой пилюли (кабинет, этап 0): без метки кабинета — прежний
// текст; с меткой — по снимку сессии.
describe('shadowLockedTitle', () => {
  function mark() {
    const m = document.createElement('meta')
    m.name = 'flib-cabinet'
    m.content = '1'
    document.head.appendChild(m)
  }
  beforeEach(() => { __resetSessionForTests() })
  afterEach(() => {
    document.head.querySelectorAll('meta[name="flib-cabinet"]').forEach((m) => m.remove())
    __resetSessionForTests()
  })

  it('кабинет выключен (нет метки) — прежний текст, даже при активной сессии', () => {
    __setSessionForTests({ authenticated: true, state: 'active', cabinet: true, shadowing: false })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_LEGACY)
  })

  it('кабинет включён, активная сессия без Shadowing — «не входит в Ваш ключ»', () => {
    mark()
    __setSessionForTests({ authenticated: true, state: 'active', cabinet: true, shadowing: false })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_NOT_IN_KEY)
    expect(SHADOW_LOCKED_NOT_IN_KEY).toBe('Shadowing не входит в Ваш ключ.')
  })

  it('кабинет включён, не вошёл — «Войдите по ключу»', () => {
    mark()
    __setSessionForTests({ authenticated: false, cabinet: true })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_LOGIN)
    expect(SHADOW_LOCKED_LOGIN).toBe('Войдите по ключу, чтобы открыть Shadowing.')
  })

  it('кабинет включён, снимка ещё нет — «Войдите по ключу»', () => {
    mark()
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_LOGIN)
  })

  it('кабинет включён, ключ сессии истёк — «Срок действия ключа закончился»', () => {
    mark()
    __setSessionForTests({ authenticated: true, state: 'expired', cabinet: true })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_EXPIRED)
    expect(SHADOW_LOCKED_EXPIRED).toBe('Срок действия ключа закончился.')
  })

  // Ревью L1: вошедшему пользователю при недоступном шлюзе «Войдите» не
  // поможет — доступ просто не удалось проверить.
  it('кабинет включён, вошёл, шлюз недоступен (state unknown) — «Не удалось проверить доступ»', () => {
    mark()
    __setSessionForTests({ authenticated: true, state: 'unknown', cabinet: true })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_UNAVAILABLE)
    expect(SHADOW_LOCKED_UNAVAILABLE).toBe('Не удалось проверить доступ. Попробуйте позже.')
  })

  it('кабинет включён, сбой чтения после активной сессии — «Не удалось проверить доступ»', () => {
    mark()
    // так refreshSession сохраняет снимок вошедшего при сбое сети/5xx
    __setSessionForTests({ authenticated: true, state: 'unknown', cabinet: true, failures: 2 })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_UNAVAILABLE)
  })

  it('кабинет включён, первое чтение сессии упало (status error) — «Не удалось проверить доступ»', () => {
    mark()
    __setSessionForTests({ status: 'error', failures: 1 })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_UNAVAILABLE)
  })

  it('кабинет включён, не вошёл и сбой перечитывания — всё равно «Войдите по ключу»', () => {
    mark()
    __setSessionForTests({ authenticated: false, cabinet: true, failures: 1 })
    expect(shadowLockedTitle()).toBe(SHADOW_LOCKED_LOGIN)
  })
})

describe('hasShadowingAccess', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('no flib:access record → false (default-deny)', () => {
    expect(hasShadowingAccess()).toBe(false)
  })

  it('flib:access with shadowing:true → true', () => {
    window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_dead', checkedAt: 'x' }))
    expect(hasShadowingAccess()).toBe(true)
  })

  it('flib:access with shadowing:false → false', () => {
    window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: false, keyPrefix: 'tpk_cafe', checkedAt: 'x' }))
    expect(hasShadowingAccess()).toBe(false)
  })

  it('corrupt flib:access JSON → false, does not throw', () => {
    window.localStorage.setItem('flib:access', 'not json{{{')
    expect(() => hasShadowingAccess()).not.toThrow()
    expect(hasShadowingAccess()).toBe(false)
  })

  it('malformed shape (shadowing as string "true") → false (strict boolean check)', () => {
    window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: 'true', keyPrefix: 'tpk_x', checkedAt: 'x' }))
    expect(hasShadowingAccess()).toBe(false)
  })
})
