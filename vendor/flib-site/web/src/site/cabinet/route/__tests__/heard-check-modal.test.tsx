// heard-check-modal.test.tsx — экран теста после ролика: тексты, клавиатура (E7),
// фокус, роли, уход без ответа (E4).
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { HeardCheckHost } from '../heard-check/HeardCheckModal'
import { abandonHeardCheck, askHeardCheck, type HeardOutcome } from '../heard-check/heard-check-store'
import cssRaw from '../heard-check/heard-check.css?raw'
import type { HeardQuestion } from '../route-api'

const Q: HeardQuestion = { id: 'hc:2026-11-18:youtube::abc123XYZ_1', kind: 'heard_check', puzzle_id: 'youtube::abc123XYZ_1', words: ['alpha', 'beta', 'gamma'] }

function Nav() { const n = useNavigate(); return <button data-testid="go" onClick={() => n('/elsewhere')}>go</button> }
function mount() {
  return render(<MemoryRouter><button data-testid="before">before</button><Nav /><HeardCheckHost /></MemoryRouter>)
}
let result: HeardOutcome | null
async function open(q = Q) {
  result = null
  await act(async () => { void askHeardCheck(q).then(r => { result = r }) })
}
const key = (k: string, init: KeyboardEventInit = {}) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })

beforeEach(() => { abandonHeardCheck() })

describe('HeardCheckModal', () => {
  it('тексты дословно, роли, chips с aria-pressed, фокус в диалоге', async () => {
    mount()
    await open()
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(within(dlg).getByText('Тест после ролика')).toBeTruthy()
    expect(within(dlg).getByText('Отметьте слова, которые Вы услышали в этом ролике')).toBeTruthy()
    expect(within(dlg).getByText('Цифры 1–6 — отметить слово, Enter — готово, Esc — пропустить')).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: 'Готово' })).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: 'Пропустить' })).toBeTruthy()
    const chips = screen.getAllByTestId('hc-word')
    expect(chips.map(c => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    expect(document.activeElement).toBe(dlg)
    fireEvent.click(chips[1])
    expect(chips[1].getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.hc-root')).toBeTruthy()
  })

  it('цифры переключают (автоповтор игнорируется); Enter = «Готово» с отмеченными в порядке показа', async () => {
    mount()
    await open()
    await key('3'); await key('1'); await key('1', { repeat: true }); await key('7'); await key('0')
    expect(screen.getAllByTestId('hc-word').map(c => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'true'])
    await key('Enter')
    expect(result).toEqual({ outcome: 'answered', marked: ['alpha', 'gamma'] })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc = «Пропустить» → declined', async () => {
    mount()
    await open()
    await key('1')
    await key('Escape')
    expect(result).toEqual({ outcome: 'declined' })
  })

  it('Enter/пробел на кнопке в фокусе нажимают ЭТУ кнопку, а не «Готово»', async () => {
    mount()
    await open()
    screen.getByTestId('hc-skip').focus()
    await key('Enter')
    expect(result).toEqual({ outcome: 'declined' })
    await open()
    const chip = screen.getAllByTestId('hc-word')[2]
    chip.focus()
    await key(' ')
    expect(result).toBeNull()
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await key('Enter') // Enter на плашке в фокусе переключает её же, ответ не отправляет
    expect(result).toBeNull()
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    await key(' ')
    screen.getByRole('dialog').focus()
    await key('Enter')
    expect(result).toEqual({ outcome: 'answered', marked: ['gamma'] })
  })

  it('клавиши не доходят до плеера: window capture + stopPropagation (E7)', async () => {
    mount()
    await open()
    const seen: string[] = []
    const onDoc = (e: KeyboardEvent) => seen.push(e.key)
    document.addEventListener('keydown', onDoc)
    document.body.addEventListener('keydown', onDoc)
    for (const k of ['1', ' ', 'ArrowLeft', 'f', 'Tab']) {
      act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
    }
    document.removeEventListener('keydown', onDoc)
    document.body.removeEventListener('keydown', onDoc)
    expect(seen).toEqual([])
  })

  it('Tab ходит по кругу внутри диалога', async () => {
    mount()
    await open()
    const done = screen.getByTestId('hc-done')
    done.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => { window.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(screen.getAllByTestId('hc-word')[0])
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    act(() => { window.dispatchEvent(back) })
    expect(document.activeElement).toBe(done)
  })

  it('фокус возвращается туда, где был', async () => {
    mount()
    const before = screen.getByTestId('before')
    before.focus()
    await open()
    await key('Escape')
    expect(document.activeElement).toBe(before)
  })

  it('уход со страницы при открытом экране — abandoned, declined не уходит (E4)', async () => {
    mount()
    await open()
    fireEvent.click(screen.getByTestId('go'))
    await act(async () => {})
    expect(result).toBe('abandoned')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('размонтирование при открытом экране — abandoned', async () => {
    const r = mount()
    await open()
    r.unmount()
    await act(async () => {})
    expect(result).toBe('abandoned')
  })

  it('второй вопрос при открытом первом не открывается и первый не закрывает (E5)', async () => {
    mount()
    await open()
    const second = await askHeardCheck({ ...Q, id: 'hc:2026-11-18:other' })
    expect(second).toBe('abandoned')
    expect(result).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await key('Escape')
    expect(result).toEqual({ outcome: 'declined' })
  })

  it('CSS не течёт: все правила heard-check.css под .hc-root', () => {
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = css.split('}').map(b => b.split('{')[0].trim()).filter(s => s && !s.startsWith('@'))
    for (const sel of selectors) for (const part of sel.split(',')) expect(part.trim().startsWith('.hc-root')).toBe(true)
  })
})
