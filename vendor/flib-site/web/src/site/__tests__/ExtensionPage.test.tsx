import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ExtensionPage } from '../ExtensionPage'
import { CHROME_WEB_STORE_URL, EXTENSION_SOURCE_URL } from '../external-links'

function renderPage() {
  return render(<MemoryRouter initialEntries={['/extension']}><ExtensionPage /></MemoryRouter>)
}

function card(container: HTMLElement, title: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.fork-card'))
    .find(c => c.querySelector('h3')?.textContent === title)
  if (!found) throw new Error(`нет карточки ${title}`)
  return found
}

describe('ExtensionPage', () => {
  it.each(['Chrome', 'Edge', 'Яндекс Браузер, Opera, Brave, Vivaldi'])('%s ведёт в Chrome Web Store', title => {
    const { container } = renderPage()
    const link = card(container, title)
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe(CHROME_WEB_STORE_URL)
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('Firefox без ссылки, пока Mozilla не одобрила', () => {
    const { container } = renderPage()
    const firefox = card(container, 'Firefox')
    expect(firefox.tagName).toBe('DIV')
    expect(firefox.querySelector('a')).toBeNull()
    expect(within(firefox).getByText('На проверке')).toBeTruthy()
  })

  it('установка не ведёт на релизы GitHub, код доступен отдельной ссылкой', () => {
    const { container, getByRole } = renderPage()
    expect(container.querySelector('a[href*="/releases"]')).toBeNull()
    expect(getByRole('link', { name: 'Открытый код на GitHub' }).getAttribute('href')).toBe(EXTENSION_SOURCE_URL)
  })

  it('открывается с начала страницы', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderPage()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    scrollTo.mockRestore()
  })

  it('возвращает на главную', () => {
    const { getByRole } = renderPage()
    expect(getByRole('link', { name: '← на главную' }).getAttribute('href')).toBe('/')
  })
})
