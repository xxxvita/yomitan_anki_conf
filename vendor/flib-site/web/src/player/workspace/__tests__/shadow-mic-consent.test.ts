// shadow-mic-consent.test.ts — pure read/write seam for session mic consent.
// Verifies: only 'granted' persists/reads back, foreign/missing → null, and
// storage that THROWS (private mode) fails closed (read→null) without crashing
// (write→no throw). Storage is injected so no global sessionStorage is touched.
import { describe, it, expect } from 'vitest'
import {
  readStoredMicConsent,
  writeStoredMicConsent,
  MIC_CONSENT_KEY,
} from '../shadow-mic-consent'

function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

function throwingStorage(): Storage {
  const boom = () => { throw new Error('storage disabled') }
  return {
    get length(): number { throw new Error('storage disabled') },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  }
}

describe('shadow-mic-consent', () => {
  it('empty storage → null (nobody granted)', () => {
    expect(readStoredMicConsent(memStorage())).toBeNull()
  })

  it('write then read → granted (round-trip under the canonical key)', () => {
    const s = memStorage()
    writeStoredMicConsent(s)
    expect(s.getItem(MIC_CONSENT_KEY)).toBe('granted')
    expect(readStoredMicConsent(s)).toBe('granted')
  })

  it('a foreign/stale value under the key is NOT treated as granted', () => {
    expect(readStoredMicConsent(memStorage({ [MIC_CONSENT_KEY]: 'yes' }))).toBeNull()
    expect(readStoredMicConsent(memStorage({ [MIC_CONSENT_KEY]: 'pending' }))).toBeNull()
    expect(readStoredMicConsent(memStorage({ [MIC_CONSENT_KEY]: '' }))).toBeNull()
  })

  it('read fails closed when storage throws (private mode) — null, no crash', () => {
    expect(readStoredMicConsent(throwingStorage())).toBeNull()
  })

  it('write is best-effort when storage throws — swallows, does not crash caller', () => {
    expect(() => writeStoredMicConsent(throwingStorage())).not.toThrow()
  })
})
