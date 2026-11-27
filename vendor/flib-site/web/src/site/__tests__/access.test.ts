// access.test.ts — Э6, Shadowing-гейт: localStorage-контракт (flib:access/
// flib:tpk) + checkAccess() против POST /api/access.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveAccess, loadAccess, clearAccess, checkAccess } from '../access'

describe('saveAccess / loadAccess / clearAccess', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('round-trips a saved state', () => {
    saveAccess({ shadowing: true, keyPrefix: 'tpk_dead', checkedAt: '2026-07-13T00:00:00.000Z' })
    expect(loadAccess()).toEqual({ shadowing: true, keyPrefix: 'tpk_dead', checkedAt: '2026-07-13T00:00:00.000Z' })
  })

  it('loadAccess returns null when nothing saved', () => {
    expect(loadAccess()).toBeNull()
  })

  it('loadAccess returns null on corrupt JSON (does not throw)', () => {
    window.localStorage.setItem('flib:access', 'not json{{{')
    expect(loadAccess()).toBeNull()
  })

  it('loadAccess returns null when shape is wrong (missing/wrong-typed fields)', () => {
    window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: 'yes', keyPrefix: 'tpk_x' }))
    expect(loadAccess()).toBeNull()
    window.localStorage.setItem('flib:access', JSON.stringify({ foo: 'bar' }))
    expect(loadAccess()).toBeNull()
  })

  it('clearAccess removes both flib:access and flib:tpk', () => {
    window.localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_dead', checkedAt: 'x' }))
    window.localStorage.setItem('flib:tpk', 'tpk_deadbeefdeadbeefdeadbeefdeadbeef')
    clearAccess()
    expect(window.localStorage.getItem('flib:access')).toBeNull()
    expect(window.localStorage.getItem('flib:tpk')).toBeNull()
  })
})

describe('checkAccess', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('valid + shadowing capability → saves flib:access and flib:tpk, returns shadowing:true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: true, shadowing: true, key_prefix: 'tpk_dead' }),
    })))
    const result = await checkAccess('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
    expect(result).toEqual({ ok: true, valid: true, shadowing: true, keyPrefix: 'tpk_dead' })
    expect(loadAccess()).toMatchObject({ shadowing: true, keyPrefix: 'tpk_dead' })
    expect(window.localStorage.getItem('flib:tpk')).toBe('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
  })

  it('valid without capability → saves shadowing:false, does not gate save on capability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: true, shadowing: false, key_prefix: 'tpk_cafe' }),
    })))
    const result = await checkAccess('tpk_cafecafecafecafecafecafecafecafe')
    expect(result.valid).toBe(true)
    expect(result.shadowing).toBe(false)
    expect(loadAccess()).toMatchObject({ shadowing: false, keyPrefix: 'tpk_cafe' })
  })

  it('invalid key (200 {valid:false}) → does not save anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: false, shadowing: false }),
    })))
    const result = await checkAccess('tpk_00000000000000000000000000000000')
    expect(result).toEqual({ ok: true, valid: false, shadowing: false, keyPrefix: '' })
    expect(loadAccess()).toBeNull()
    expect(window.localStorage.getItem('flib:tpk')).toBeNull()
  })

  it('bad format (400) → ok:false, does not save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400 })))
    const result = await checkAccess('not-a-key')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('http_400')
    expect(loadAccess()).toBeNull()
  })

  it('gateway unavailable (502) → ok:false, does not save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })))
    const result = await checkAccess('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('http_502')
    expect(loadAccess()).toBeNull()
  })

  it('network failure (fetch throws) → ok:false, error network, does not save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await checkAccess('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('network')
    expect(loadAccess()).toBeNull()
  })

  it('does NOT persist prior valid state to a new network failure — leaves old access untouched', async () => {
    saveAccess({ shadowing: true, keyPrefix: 'tpk_old1', checkedAt: 'x' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await checkAccess('tpk_deadbeefdeadbeefdeadbeefdeadbeef')
    expect(loadAccess()).toMatchObject({ keyPrefix: 'tpk_old1' })
  })
})
