// https-upgrade.test.ts — финальное ревью PR-A F-2: на http:// (не петля)
// страница с меткой кабинета уходит на https до показа формы входа: на http
// сторож CSRF BFF отвергает вход (Origin http://), а cookie __Host-/Secure не
// сохраняется.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { httpsUpgradeTarget, redirectToHttpsIfNeeded } from '../https-upgrade'
import { setCabinetMarker } from './cabinet-marker'

const loc = (href: string) => {
  const u = new URL(href)
  return { protocol: u.protocol, hostname: u.hostname, host: u.host, pathname: u.pathname, search: u.search, hash: u.hash }
}

describe('httpsUpgradeTarget', () => {
  it('http + метка кабинета на боевом хосте → тот же адрес на https', () => {
    expect(httpsUpgradeTarget(loc('http://flib.club/login?next=%2Fapp%2Froute#x'), true))
      .toBe('https://flib.club/login?next=%2Fapp%2Froute#x')
    expect(httpsUpgradeTarget(loc('http://flibooster.ru/app'), true)).toBe('https://flibooster.ru/app')
    expect(httpsUpgradeTarget(loc('http://flib.club:8080/'), true)).toBe('https://flib.club:8080/')
  })

  it('без метки кабинета — ничего (сайт как до кабинета)', () => {
    expect(httpsUpgradeTarget(loc('http://flib.club/login'), false)).toBeNull()
  })

  it('уже https — ничего', () => {
    expect(httpsUpgradeTarget(loc('https://flib.club/login'), true)).toBeNull()
  })

  it('петля по http (локальная проверка A9) — ничего', () => {
    for (const h of ['http://localhost:8080/login', 'http://127.0.0.1:5173/app', 'http://[::1]:8080/login', 'http://localhost/']) {
      expect(httpsUpgradeTarget(loc(h), true)).toBeNull()
    }
  })

  it('похожие на петлю имена — не петля', () => {
    expect(httpsUpgradeTarget(loc('http://localhost.evil.example/login'), true)).toBe('https://localhost.evil.example/login')
    expect(httpsUpgradeTarget(loc('http://127.0.0.2/login'), true)).toBe('https://127.0.0.2/login')
  })
})

describe('redirectToHttpsIfNeeded (main.tsx)', () => {
  afterEach(() => setCabinetMarker(false))
  const fake = (href: string) => ({ ...loc(href), replace: vi.fn() })

  it('метка кабинета и http на боевом хосте — replace на https, страницу не рисовать', () => {
    setCabinetMarker(true)
    const l = fake('http://flib.club/login')
    expect(redirectToHttpsIfNeeded(l)).toBe(true)
    expect(l.replace).toHaveBeenCalledWith('https://flib.club/login')
  })

  it('без метки — остаёмся на http, как до кабинета', () => {
    setCabinetMarker(false)
    const l = fake('http://flib.club/login')
    expect(redirectToHttpsIfNeeded(l)).toBe(false)
    expect(l.replace).not.toHaveBeenCalled()
  })
})
