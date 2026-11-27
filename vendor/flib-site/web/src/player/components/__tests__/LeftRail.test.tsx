// LeftRail.test.tsx — левое меню плеера v2 (дизайн владельца 2026-11-19 §4,
// docs/design/cabinet-2026-11-19/src/cab/cab-player.*; решение владельца
// 2026-11-19 п.2 об уведомлениях). Три пункта: «Главная», «Уведомления» (только
// вошедшему), «Улучшенные субтитры»; «Свернуть» внизу — 208 ↔ 60 px, помнится в
// localStorage; панели 320 px справа от меню; на телефоне меню — выезжающая
// панель с затемнением (кнопка ☰ в верхней строке плеера).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LeftRail } from '../LeftRail'
import { __resetSessionForTests, __setSessionForTests } from '../../../site/session'
import { setCabinetMarker } from '../../../site/__tests__/cabinet-marker'
import { __resetRouteStateForTests, __setLastRouteReadForTests } from '../../../site/cabinet/route/use-route-state'
import { st, del, und } from '../../../site/cabinet/route/__tests__/route-page-fakes'
import { learningDayOf, SITE_TRANSITION_MIN } from '../../../site/cabinet/route/learning-day'

const RAIL_KEY = 'flib:shell:railCollapsed'
const navigateMock = vi.fn()

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
const signedIn = (over: Record<string, unknown> = {}) => {
  setCabinetMarker(true)
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', keyExpiresAt: daysFromNow(30), ...over })
}
const todayRead = () => {
  const s = st([del(1), und()])
  s.day = { ...s.day!, date: learningDayOf(new Date(), SITE_TRANSITION_MIN) }
  return { result: { ok: true as const, status: 200, data: s }, sent: { watchedSeq: 0, pendingClipPlayed: new Set<string>() } }
}
const items = (root: HTMLElement) => Array.from(root.querySelectorAll('.pl-nav button')).map(b => b.getAttribute('data-testid'))

function mount(props: { drawerOpen?: boolean; onDrawerClose?: () => void } = {}) {
  return render(<MemoryRouter><LeftRail {...props} /></MemoryRouter>)
}

describe('LeftRail v2', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    localStorage.clear()
    __resetSessionForTests()
    __resetRouteStateForTests()
    setCabinetMarker(false)
  })
  afterEach(() => { cleanup(); setCabinetMarker(false); __resetSessionForTests(); __resetRouteStateForTests() })

  it('гость: «Главная» и «Улучшенные субтитры», без «Уведомлений»', () => {
    const { getByTestId } = mount()
    expect(items(getByTestId('left-rail'))).toEqual(['rail-home', 'rail-pipeline'])
  })

  it('вошедший: «Главная», «Уведомления», «Улучшенные субтитры»', () => {
    signedIn()
    const { getByTestId } = mount()
    expect(items(getByTestId('left-rail'))).toEqual(['rail-home', 'rail-notifications', 'rail-pipeline'])
  })

  it('ни одного пункта «Скоро» не осталось', () => {
    signedIn()
    const { getByTestId } = mount()
    expect(getByTestId('left-rail').textContent).not.toContain('Скоро')
  })

  describe('«Свернуть»', () => {
    it('по умолчанию развёрнуто (подписи видны), «Свернуть» внизу', () => {
      const { container, getByRole } = mount()
      expect((container.querySelector('.plv2') as HTMLElement).className).not.toContain('mini')
      expect(getByRole('button', { name: 'Свернуть меню' }).textContent).toBe('Свернуть')
    })

    it('свернуть — класс mini, подсказки title у пунктов, запоминается в localStorage', () => {
      const { container, getByRole, getByTestId } = mount()
      fireEvent.click(getByRole('button', { name: 'Свернуть меню' }))
      expect((container.querySelector('.plv2') as HTMLElement).className).toContain('mini')
      expect(localStorage.getItem(RAIL_KEY)).toBe('true')
      expect(getByTestId('rail-home').getAttribute('title')).toBe('Главная')
      fireEvent.click(getByRole('button', { name: 'Развернуть меню' }))
      expect(localStorage.getItem(RAIL_KEY)).toBe('false')
      expect(getByTestId('rail-home').getAttribute('title')).toBeNull()
    })

    it('сохранённое «свёрнуто» восстанавливается', () => {
      localStorage.setItem(RAIL_KEY, 'true')
      const { container } = mount()
      expect((container.querySelector('.plv2') as HTMLElement).className).toContain('mini')
    })
  })

  describe('«Главная»', () => {
    it('гость (кабинет выключен): на «/»', () => {
      const { getByTestId } = mount()
      fireEvent.click(getByTestId('rail-home'))
      expect(navigateMock).toHaveBeenCalledWith('/')
    })
    it('гость при включённом кабинете (не вошёл): на «/»', () => {
      setCabinetMarker(true)
      __setSessionForTests({ cabinet: true, authenticated: false })
      const { getByTestId } = mount()
      fireEvent.click(getByTestId('rail-home'))
      expect(navigateMock).toHaveBeenCalledWith('/')
    })
    it('вошедший: на главную кабинета /app', () => {
      signedIn()
      const { getByTestId } = mount()
      fireEvent.click(getByTestId('rail-home'))
      expect(navigateMock).toHaveBeenCalledWith('/app')
    })
    it('ключ истёк, но сессия есть: тоже /app', () => {
      signedIn({ state: 'expired' })
      const { getByTestId } = mount()
      fireEvent.click(getByTestId('rail-home'))
      expect(navigateMock).toHaveBeenCalledWith('/app')
    })
    it('снимок «вошёл», но метки кабинета нет: на «/»', () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const { getByTestId } = mount()
      fireEvent.click(getByTestId('rail-home'))
      expect(navigateMock).toHaveBeenCalledWith('/')
    })
  })

  describe('«Улучшенные субтитры» — боковая панель', () => {
    it('панель вместо окна: текст, четыре скриншота приложения, «Скачать Flibooster» на /download.html', () => {
      const { getByTestId, queryByTestId } = mount()
      expect(queryByTestId('improve-subs-panel')).toBeNull()
      fireEvent.click(getByTestId('rail-pipeline'))
      const p = getByTestId('improve-subs-panel')
      expect(p.className).toContain('pl-panel')
      expect(p.querySelector('.pl-ph .serif')?.textContent).toBe('Улучшенные субтитры')
      expect(p.querySelector('.ps p')?.textContent).toBe('В программе Flibooster на ПК Вам доступно намного больше функций, чем это можно реализовать в Вашем браузере.')
      expect(Array.from(p.querySelectorAll('.ps-list li')).map(li => li.textContent)).toEqual([
        'С помощью специального модуля Вы сможете улучшить автоматические субтитры.',
        'Вы сможете проработать свои записанные в аудио и видео встречи с преподавателем в удобном кабинете.',
        'Расширить функционал программы, разработав свои модули с помощью ИИ или сами.',
        'Смотреть свою коллекцию видео с помощью нашего плеера, и прорабатывать навыки языка самостоятельно.',
        'В специальной «акустической» студии позаниматься запоминанием слов из Anki.',
      ])
      const more = within(p).getByRole('link', { name: 'странице скачивания' })
      expect(more.getAttribute('href')).toBe('/download.html')
      expect(more.getAttribute('target')).toBe('_blank')
      expect(more.getAttribute('rel')).toBe('noopener noreferrer')
      const imgs = Array.from(p.querySelectorAll('.ps-shots img'))
      expect(imgs).toHaveLength(4)
      for (const img of imgs) {
        expect(img.getAttribute('src') ?? '').toMatch(/\.webp/)
        expect(img.getAttribute('alt') ?? '').toMatch(/[а-яё]/i)
      }
      const items = Array.from(p.querySelectorAll('.ps-shots li'))
      expect(items.map(li => li.querySelector('.ps-cap')?.textContent)).toEqual([
        'Плеер в приложении', 'Раздел встречи с преподавателем', 'Аудиокабинка', 'Избранные каналы Youtube',
      ])
      expect(imgs.map(i => (i.getAttribute('src') ?? '').match(/(shadowing|transcript|audio-booth|youtube)/)?.[1])).toEqual(['shadowing', 'transcript', 'audio-booth', 'youtube'])
      for (const li of items) {
        const cap = li.querySelector('.ps-cap') as Element
        const img = li.querySelector('img') as Element
        expect(cap.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        const a = li.querySelector('a') as HTMLAnchorElement
        expect(a.getAttribute('target')).toBe('_blank')
        expect(a.getAttribute('rel')).toContain('noopener')
      }
      const dl = within(p).getByRole('link', { name: 'Скачать Flibooster' })
      expect(dl.getAttribute('href')).toBe('/download.html')
      expect(dl.className).toContain('primary')
      expect(getByTestId('rail-pipeline').className).toBe('on')
      expect(queryByTestId('improve-subs-modal')).toBeNull()
    })

    it('повторное нажатие, ✕ и Escape закрывают панель', () => {
      const { getByTestId, queryByTestId, getByRole } = mount()
      fireEvent.click(getByTestId('rail-pipeline'))
      fireEvent.click(getByTestId('rail-pipeline'))
      expect(queryByTestId('improve-subs-panel')).toBeNull()
      fireEvent.click(getByTestId('rail-pipeline'))
      fireEvent.click(getByRole('button', { name: 'Закрыть' }))
      expect(queryByTestId('improve-subs-panel')).toBeNull()
      fireEvent.click(getByTestId('rail-pipeline'))
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(queryByTestId('improve-subs-panel')).toBeNull()
    })
  })

  describe('«Уведомления»', () => {
    it('пусто — колокольчик, «Пока пусто.» и пояснение; бейджа нет', () => {
      signedIn()
      const { getByTestId } = mount()
      expect(getByTestId('rail-notifications').querySelector('.pl-badge')).toBeNull()
      fireEvent.click(getByTestId('rail-notifications'))
      const p = getByTestId('notifications-panel')
      expect(p.querySelector('.nt-empty svg')).toBeTruthy()
      expect(p.querySelector('.nt-empty')?.textContent).toBe('Пока пусто.Здесь появятся готовый день маршрута и напоминание о сроке ключа.')
      expect(within(p).queryByRole('button', { name: 'Отметить все прочитанными' })).toBeNull()
    })

    it('ключ кончается через 3 дня и день готов: бейдж 2, оба непрочитаны, действия ведут куда надо', () => {
      signedIn({ keyExpiresAt: daysFromNow(2.5) })
      __setLastRouteReadForTests(todayRead())
      const { getByTestId } = mount()
      expect(getByTestId('rail-notifications').querySelector('.pl-badge')?.textContent).toBe('2')
      fireEvent.click(getByTestId('rail-notifications'))
      const p = getByTestId('notifications-panel')
      const rows = Array.from(p.querySelectorAll('.nt'))
      expect(rows).toHaveLength(2)
      expect(rows.every(r => r.className.includes('un'))).toBe(true)
      expect(rows[0].querySelector('.nt-t')?.textContent).toMatch(/^День \d+ [а-я]+ готов$/)
      expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Открыть маршрут' }).getAttribute('href')).toBe('/app/route')
      expect(rows[1].querySelector('.nt-t')?.textContent).toBe('Ключ закончится через 3 дня')
      expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Продлить' }).getAttribute('href')).toBe('/buy#renew')
    })

    it('«Отметить все прочитанными» — без подсветки и бейджа, помнится после перемонтирования', () => {
      signedIn({ keyExpiresAt: daysFromNow(2.5) })
      const { getByTestId, unmount } = mount()
      fireEvent.click(getByTestId('rail-notifications'))
      fireEvent.click(within(getByTestId('notifications-panel')).getByRole('button', { name: 'Отметить все прочитанными' }))
      expect(getByTestId('notifications-panel').querySelector('.nt.un')).toBeNull()
      expect(getByTestId('rail-notifications').querySelector('.pl-badge')).toBeNull()
      unmount()
      const again = mount()
      expect(again.getByTestId('rail-notifications').querySelector('.pl-badge')).toBeNull()
    })

    it('новое чтение маршрута с готовым днём появляется без перемонтирования', () => {
      signedIn()
      const { getByTestId } = mount()
      expect(getByTestId('rail-notifications').querySelector('.pl-badge')).toBeNull()
      act(() => { __setLastRouteReadForTests(todayRead()) })
      expect(getByTestId('rail-notifications').querySelector('.pl-badge')?.textContent).toBe('1')
    })

    it('уведомления и субтитры — одна панель за раз', () => {
      signedIn()
      const { getByTestId, queryByTestId } = mount()
      fireEvent.click(getByTestId('rail-notifications'))
      fireEvent.click(getByTestId('rail-pipeline'))
      expect(queryByTestId('notifications-panel')).toBeNull()
      expect(getByTestId('improve-subs-panel')).toBeTruthy()
    })
  })

  describe('телефон: выезжающая панель', () => {
    it('закрыта — без затемнения; открыта — класс open и затемнение, клик по нему закрывает', () => {
      const onClose = vi.fn()
      const closed = mount({ drawerOpen: false, onDrawerClose: onClose })
      expect(closed.getByTestId('left-rail').className).not.toContain('open')
      expect(closed.container.querySelector('.pl-scrim')).toBeNull()
      closed.unmount()
      const open = mount({ drawerOpen: true, onDrawerClose: onClose })
      expect(open.getByTestId('left-rail').className).toContain('open')
      fireEvent.click(open.container.querySelector('.pl-scrim') as HTMLElement)
      expect(onClose).toHaveBeenCalled()
    })

    it('открытие панели пункта закрывает выезжающее меню', () => {
      const onClose = vi.fn()
      const { getByTestId } = mount({ drawerOpen: true, onDrawerClose: onClose })
      fireEvent.click(getByTestId('rail-pipeline'))
      expect(onClose).toHaveBeenCalled()
    })
  })
})
