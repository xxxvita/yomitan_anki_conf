// session-logout-race.test.ts — финальное ревью PR-A F-1: «Выход» не
// отменяется чтением GET /api/session, начатым до DELETE.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetSessionForTests, __setSessionForTests, cabinetLogout, getSession, refreshSession, subscribeSession } from '../session'

const ACTIVE = {
  authenticated: true, state: 'active', cabinet: true, key_prefix: 'tpk_aaaa', demo: false,
  key_expires_at: '2026-11-24T00:00:00Z', shadowing: true, route_allowed: true,
}
const ANON = { authenticated: false, cabinet: true }

function jsonResp(status: number, body?: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Call { method: string; signal: AbortSignal | null; abortedAtDelete?: boolean }

// Фальшивый BFF: первый GET висит, пока его не оборвут (как медленный шлюз);
// дальнейшие GET отвечают из очереди getAfter; DELETE — deleteStatus.
function stubBFF(getAfter: unknown[], deleteStatus = 204) {
  const calls: Call[] = []
  let hanging: AbortSignal | null = null
  const f = vi.fn((_url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const call: Call = { method, signal: init.signal ?? null }
    calls.push(call)
    if (method === 'DELETE') {
      call.abortedAtDelete = hanging?.aborted ?? false
      return Promise.resolve(jsonResp(deleteStatus))
    }
    if (calls.filter(c => c.method === 'GET').length === 1) {
      hanging = init.signal ?? null
      return new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
      })
    }
    const body = getAfter.length > 1 ? getAfter.shift() : getAfter[0]
    return Promise.resolve(jsonResp(200, body))
  })
  vi.stubGlobal('fetch', f)
  return calls
}

describe('cabinetLogout и чтение в полёте (F-1)', () => {
  beforeEach(() => { localStorage.clear(); __resetSessionForTests() })
  afterEach(() => { __resetSessionForTests(); vi.unstubAllGlobals() })

  it('обрывает чтение до DELETE, после 204 перечитывает один раз и остаётся вышедшим', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' }) // кнопка «Выход» видна
    const calls = stubBFF([ANON])
    const pending = refreshSession() // чтение в полёте, ответа нет (возврат на вкладку)
    expect(await cabinetLogout()).toBe(true)
    const del = calls.find(c => c.method === 'DELETE')!
    expect(del.abortedAtDelete).toBe(true) // оборвано ДО отправки DELETE
    expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout', cabinet: true })
    await pending
    await new Promise(r => setTimeout(r, 0))
    // Ровно два GET: оборванный и одно перечитывание после 204; оборванное
    // чтение нового не начинает и снимок не трогает.
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(2)
    expect(calls.map(c => c.method)).toEqual(['GET', 'DELETE', 'GET'])
    expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout' })
  })

  it('сервер после 204 всё ещё говорит «вошёл» — снимок по серверу, false', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stubBFF([ACTIVE])
    void refreshSession()
    expect(await cabinetLogout()).toBe(false)
    expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
  })

  it('чтение, запрошенное во время выхода, ждёт конца выхода', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    const calls = stubBFF([ANON])
    void refreshSession()
    const out = cabinetLogout()
    const during = refreshSession() // например, возврат на вкладку
    expect(await out).toBe(true)
    await during
    const methods = calls.map(c => c.method)
    expect(methods.indexOf('DELETE')).toBeLessThan(methods.lastIndexOf('GET'))
    expect(getSession().authenticated).toBe(false)
  }, 1000) // без обрыва чтение висело бы до своего срока (3 с) — тест падает по времени

  it('оборванное чтение снимок не трогает: ни «unknown», ни счётчика сбоев во время выхода', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stubBFF([ANON])
    void refreshSession()
    const seen: { state: string | null; failures: number; authenticated: boolean }[] = []
    const off = subscribeSession(() => { const s = getSession(); seen.push({ state: s.state, failures: s.failures, authenticated: s.authenticated }) })
    expect(await cabinetLogout()).toBe(true)
    off()
    expect(seen.filter(x => x.state === 'unknown' || x.failures > 0)).toEqual([])
  })

  it('чтение, запрошенное во время выхода, не уходит раньше ответа на DELETE', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    const calls: string[] = []
    let releaseDelete: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push(method)
      if (method === 'DELETE') return new Promise<Response>(res => { releaseDelete = () => res(jsonResp(204)) })
      return Promise.resolve(jsonResp(200, ANON))
    }))
    const out = cabinetLogout()
    const during = refreshSession() // возврат на вкладку, пока DELETE в пути
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toEqual(['DELETE']) // GET ждёт выхода
    releaseDelete()
    expect(await out).toBe(true)
    await during
    expect(calls[0]).toBe('DELETE')
    expect(calls.slice(1).every(m => m === 'GET')).toBe(true)
    expect(getSession().authenticated).toBe(false)
  })

  it('reason "logged_out" сервера — «вы вышли»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResp(200, { authenticated: false, cabinet: true, reason: 'logged_out' })))
    expect(await refreshSession()).toMatchObject({ authenticated: false, reason: 'logout' })
  })

  // Повторное ревью F-1 (R-1): после 204 cookie может вернуться — запрос
  // ДРУГОЙ вкладки, отвеченный другим подом во время выкатки или в окне
  // микросекунд после последней проверки надгробия. Перечитывание это видит
  // (logged_out или «вошёл» — cookie в браузере есть) и повторяет DELETE.
  describe('повтор DELETE, если cookie вернулась (R-1)', () => {
    function stubSequence(reads: unknown[]) {
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        calls.push(method)
        if (method === 'DELETE') return jsonResp(204)
        const body = reads.length > 1 ? reads.shift() : reads[0]
        return jsonResp(200, body)
      }))
      return calls
    }
    const LOGGED_OUT = { authenticated: false, cabinet: true, reason: 'logged_out' }

    it('перечитывание сказало logged_out — ещё один DELETE, потом «вышел»', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const calls = stubSequence([LOGGED_OUT, ANON])
      expect(await cabinetLogout()).toBe(true)
      expect(calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET'])
      expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout' })
    })

    it('перечитывание сказало «вошёл» — ещё один DELETE, потом «вышел»', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const calls = stubSequence([ACTIVE, ANON])
      expect(await cabinetLogout()).toBe(true)
      expect(calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET'])
      expect(getSession()).toMatchObject({ authenticated: false, reason: 'self_logout' })
    })

    it('не больше двух повторов; сервер всё «вошёл» — false, кабинет не покидаем', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const calls = stubSequence([ACTIVE])
      const seen: boolean[] = []
      const off = subscribeSession(() => { seen.push(getSession().authenticated) })
      expect(await cabinetLogout()).toBe(false)
      off()
      expect(calls).toEqual(['DELETE', 'GET', 'DELETE', 'GET', 'DELETE', 'GET'])
      expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
      // Снимок ни разу не становился «вышел»: охрана кабинета не уводит на
      // /login, и окно показывает «Не удалось выйти» (ревью LOW).
      expect(seen.includes(false)).toBe(false)
    })

    it('не больше двух повторов; сервер всё logged_out — false, «вышел» не говорим (cookie осталась)', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      const calls = stubSequence([LOGGED_OUT])
      const seen: boolean[] = []
      const off = subscribeSession(() => { seen.push(getSession().authenticated) })
      expect(await cabinetLogout()).toBe(false)
      off()
      expect(calls.filter(m => m === 'DELETE')).toHaveLength(3)
      // Снимок не становился «вышел»: кабинет на месте, окно — «Не удалось выйти».
      expect(seen.includes(false)).toBe(false)
      expect(getSession().reason).not.toBe('self_logout')
    })

    for (const failure of ['503', 'network'] as const) {
      it(`повторный DELETE после logged_out упал (${failure}) — false, «вышел» не говорим`, async () => {
        __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
        let n = 0
        const calls: string[] = []
        vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
          const method = init.method ?? 'GET'
          calls.push(method)
          if (method === 'DELETE') {
            n++
            if (n === 1) return jsonResp(204)
            if (failure === 'network') throw new TypeError('offline')
            return jsonResp(503)
          }
          return jsonResp(200, LOGGED_OUT)
        }))
        expect(await cabinetLogout()).toBe(false)
        expect(calls).toEqual(['DELETE', 'GET', 'DELETE'])
        expect(getSession().reason).not.toBe('self_logout')
        expect(getSession().authenticated).toBe(true)
      })
    }

    // Каждый DELETE обрывается через 10 с. После первого (любой исход, F-3) —
    // перечитывание; оно показало cookie — один повтор, тоже 10 с, и он упал —
    // попытки прекращаются: итог через ~20 с, чтения сессии после этого идут.
    it('DELETE завис — каждый DELETE не дольше 10 с, выход не удался, чтения сессии не заморожены (LOW)', async () => {
      vi.useFakeTimers()
      try {
        __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
        const calls: string[] = []
        vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit = {}) => {
          const method = init.method ?? 'GET'
          calls.push(method)
          if (method === 'DELETE') {
            return new Promise<Response>((_res, rej) => {
              init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
            })
          }
          return Promise.resolve(jsonResp(200, ACTIVE))
        }))
        let result: boolean | null = null
        void cabinetLogout().then(r => { result = r })
        let read = false
        void refreshSession().then(() => { read = true })
        await vi.advanceTimersByTimeAsync(9_000)
        expect(result).toBeNull()
        expect(read).toBe(false)
        expect(calls).toEqual(['DELETE'])
        await vi.advanceTimersByTimeAsync(1_500)
        expect(calls).toEqual(['DELETE', 'GET', 'DELETE']) // первый оборван, перечитывание — «вошёл», повтор
        expect(result).toBeNull()
        await vi.advanceTimersByTimeAsync(9_000)
        expect(result).toBeNull()
        expect(read).toBe(false)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(result).toBe(false)
        expect(read).toBe(true)
        expect(calls.slice(0, 3)).toEqual(['DELETE', 'GET', 'DELETE'])
        expect(getSession()).toMatchObject({ authenticated: true, state: 'active' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('повторный DELETE не 204 — false, снимок по серверу', async () => {
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      let n = 0
      const calls: string[] = []
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        calls.push(method)
        if (method === 'DELETE') return jsonResp(++n === 1 ? 204 : 503)
        return jsonResp(200, ACTIVE)
      }))
      expect(await cabinetLogout()).toBe(false)
      expect(getSession()).toMatchObject({ authenticated: true })
      // Неудачный повтор прекращает попытки: дальше ни перечитываний, ни DELETE.
      expect(calls).toEqual(['DELETE', 'GET', 'DELETE'])
    })
  })
})
