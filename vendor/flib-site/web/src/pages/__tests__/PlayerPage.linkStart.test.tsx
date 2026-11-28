// PlayerPage.linkStart.test.tsx — /player?v=…&t=<сек>: старт с секунды из ссылки (cueStart).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'

const h = vi.hoisted(() => ({
  iframeOpts: [] as any[],
  nativeOpts: [] as any[],
  iframe: null as any,
  native: null as any,
  nav: null as null | ((to: string) => void),
  origSeek: null as any,
  offCalls: 0,
  live: new Set<any>(),
}))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async (_el: string, _vid: string, opts: any) => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.iframeOpts.push(opts)
    h.iframe = makeFakeAdapter({ duration: 120, t: 0 })
    h.origSeek = h.iframe.seek
    const on = h.iframe.on
    const live = new Set<any>(); h.live = live
    h.iframe.on = (e: any, cb: any) => { const off = on(e, cb); live.add(cb); return () => { h.offCalls++; live.delete(cb); off() } }
    return h.iframe
  },
}))
vi.mock('../../adapter/NativeVideoAdapter', () => ({
  createNativeVideoAdapter: async (_el: string, _vid: string, opts: any) => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.nativeOpts.push(opts)
    h.native = makeFakeAdapter({ duration: 90, t: 0 })
    return h.native
  },
}))

beforeEach(() => {
  window.localStorage.clear(); window.sessionStorage.clear()
  h.iframeOpts = []; h.nativeOpts = []; h.iframe = null; h.native = null; h.offCalls = 0
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
    Promise.resolve(typeof url === 'string' && url.startsWith('/api/video/')
      ? { ok: true, status: 200 } : { ok: false, status: 404, json: async () => ({}), text: async () => '' })))
})
afterEach(() => vi.unstubAllGlobals())

function Nav() { const n = useNavigate(); h.nav = (to) => n(to); return null }
function renderPlayer(entry: string, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      <Nav />
      <Routes><Route path="/player" element={<PlayerPage />} /></Routes>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}
const V = 'abcdefghijk', W = 'lmnopqrstuv'
const retry = async () => {
  act(() => { h.iframe._emit('unplayable', { reason: 'botwall-suspect' }) })
  const btn = await screen.findByRole('button', { name: /Попробовать снова/ })
  act(() => { btn.click() })
}

describe('PlayerPage — старт из ссылки (t)', () => {
  it('обычная ссылка: cueStart передан', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    expect(h.iframeOpts[0].cueStart).toBe(60)
  })

  it('без t: cueStart нет', async () => {
    renderPlayer(`/player?v=${V}`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    expect(h.iframeOpts[0].cueStart).toBeUndefined()
  })

  it.each(['rp=1', 'rc=1', 'rx=1', 'route_step=s1', 'back=route'])('маршрутный параметр %s: cueStart не передаётся', async (r) => {
    renderPlayer(`/player?v=${V}&t=60&${r}`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    expect(h.iframeOpts[0].cueStart).toBeUndefined()
  })

  it('«Попробовать снова» до первого play сохраняет t', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1].cueStart).toBe(60)
  })

  it('«Попробовать снова» после play не прыгает обратно на t', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    act(() => { h.iframe._emit('state', 'playing') })
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1].cueStart).toBeUndefined()
  })

  it('seek до play съедает t (перемотка пользователя главнее)', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    act(() => { h.iframe.seek(5) })
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1].cueStart).toBeUndefined()
  })

  it('переключение на native до play сохраняет t', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    act(() => { h.iframe._emit('unplayable', { reason: 'botwall-suspect' }) })
    const btn = await screen.findByRole('button', { name: /flib-плеер/ })
    act(() => { btn.click() })
    await waitFor(() => expect(h.nativeOpts.length).toBe(1))
    expect(h.nativeOpts[0].cueStart).toBe(60)
  })

  it('другое видео без t стартует с нуля; t первой ссылки не утекает', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    act(() => { h.nav!(`/player?v=${W}`) })
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1].cueStart).toBeUndefined()
  })

  it('другое видео со своим t: считается его t', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    act(() => { h.nav!(`/player?v=${W}&t=7`) })
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1].cueStart).toBe(7)
  })

  it('opts без t — ровно {} (ключа cueStart нет), с t — ровно {cueStart}', async () => {
    renderPlayer(`/player?v=${V}`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    expect(h.iframeOpts[0]).toEqual({})
    expect('cueStart' in h.iframeOpts[0]).toBe(false)
  })

  it('opts с t передаётся ровно значением из ссылки', async () => {
    renderPlayer(`/player?v=${V}&t=137`)
    await waitFor(() => expect(h.iframeOpts.length).toBe(1))
    expect(h.iframeOpts[0]).toEqual({ cueStart: 137 })
  })

  it('обёртка seek пересылает ровно то же значение, один раз', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    const spy = vi.fn(); h.iframe._spy = spy
    act(() => { h.iframe.seek(33) })
    expect(spy.mock.calls).toEqual([['seek:33']])
  })

  it('StrictMode: seek пересылается один раз, t не съеден двойным монтажом', async () => {
    renderPlayer(`/player?v=${V}&t=60`, true)
    await waitFor(() => expect(h.iframeOpts.length).toBeGreaterThanOrEqual(1))
    expect(h.iframeOpts.every(o => o.cueStart === 60)).toBe(true)
    const spy = vi.fn(); h.iframe._spy = spy
    act(() => { h.iframe.seek(33) })
    expect(spy.mock.calls).toEqual([['seek:33']])
  })

  it('StrictMode: retry до play сохраняет t, после play — нет', async () => {
    renderPlayer(`/player?v=${V}&t=60`, true)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    await retry()
    await waitFor(() => expect(h.iframeOpts.at(-1)).toEqual({ cueStart: 60 }))
    act(() => { h.iframe._emit('state', 'playing') })
    const n = h.iframeOpts.length
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBeGreaterThan(n))
    expect(h.iframeOpts.at(-1)).toEqual({})
  })

  it('MED-A: после сыгранного ролика A собственный t ролика B учитывается', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    act(() => { h.iframe._emit('state', 'playing') })
    act(() => { h.nav!(`/player?v=${W}&t=90`) })
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1]).toEqual({ cueStart: 90 })
  })

  it('MED-A: ремаунты (retry ×2) до play не «съедают» t', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(3))
    expect(h.iframeOpts.map(o => o.cueStart)).toEqual([60, 60, 60])
  })

  it('L5: размонтирование снимает ВСЕ подписки, добавленные из-за t (число живых как без t)', async () => {
    const leaked = async (q: string) => {
      h.iframe = null
      const r = renderPlayer(`/player?v=${V}${q}`)
      await waitFor(() => expect(h.iframe).toBeTruthy())
      await act(async () => { await new Promise(r => setTimeout(r, 20)) })
      r.unmount()
      return h.live.size
    }
    const plain = await leaked('')
    const withT = await leaked('&t=60')
    expect(withT).toBe(plain)
  })

  it('L4: смена ролика не пере-оборачивает старый адаптер (seek присваивается ровно дважды: обёртка и откат)', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    const old = h.iframe
    let cur = old.seek, writes = 0
    Object.defineProperty(old, 'seek', { configurable: true, get: () => cur, set: (v) => { writes++; cur = v } })
    act(() => { h.nav!(`/player?v=${W}&t=90`) })
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(writes).toBe(1) // только откат на оригинал; новой обёртки на старый адаптер нет
  })

  it('размонтирование: seek адаптера восстановлен, подписка снята', async () => {
    const r = renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    expect(h.iframe.seek).not.toBe(h.origSeek)
    r.unmount()
    expect(h.iframe.seek).toBe(h.origSeek)
    expect(h.offCalls).toBeGreaterThan(0)
  })

  it('не-playing состояния t не съедают', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    act(() => { h.iframe._emit('state', 'buffering'); h.iframe._emit('state', 'paused'); h.iframe._emit('state', 'ended') })
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1]).toEqual({ cueStart: 60 })
  })

  it('смена query на том же ролике: t берётся из ТЕКУЩИХ params (rp → без t; другой t → он)', async () => {
    renderPlayer(`/player?v=${V}&t=60`)
    await waitFor(() => expect(h.iframe).toBeTruthy())
    act(() => { h.nav!(`/player?v=${V}&t=90`) })
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(2))
    expect(h.iframeOpts[1]).toEqual({ cueStart: 90 })
    act(() => { h.nav!(`/player?v=${V}&t=90&rp=1`) })
    await retry()
    await waitFor(() => expect(h.iframeOpts.length).toBe(3))
    expect(h.iframeOpts[2]).toEqual({})
  })
})
