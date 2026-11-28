// video-transport.test.ts [ID:P-hybrid] — pure read/write seam for the
// session-scoped player-transport choice (iframe|native). Storage is
// injected (тот же паттерн, что shadow-mic-consent.test.ts) — глобальный
// sessionStorage не трогается.
import { describe, it, expect } from 'vitest'
import {
  readStoredTransport,
  writeStoredTransport,
  clearStoredTransport,
  resolveInitialTransport,
  TRANSPORT_STORAGE_KEY,
} from '../video-transport'

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

describe('video-transport read/write seam', () => {
  it('empty storage → null (дефолт iframe)', () => {
    expect(readStoredTransport(memStorage())).toBeNull()
  })

  it('write then read → native (round-trip под каноническим ключом)', () => {
    const s = memStorage()
    writeStoredTransport(s)
    expect(s.getItem(TRANSPORT_STORAGE_KEY)).toBe('native')
    expect(readStoredTransport(s)).toBe('native')
  })

  it('чужое/устаревшее значение под ключом НЕ считается native', () => {
    expect(readStoredTransport(memStorage({ [TRANSPORT_STORAGE_KEY]: 'iframe' }))).toBeNull()
    expect(readStoredTransport(memStorage({ [TRANSPORT_STORAGE_KEY]: 'yes' }))).toBeNull()
  })

  it('чтение фейлится закрыто, если storage кидает (приватный режим) — null, без падения', () => {
    expect(readStoredTransport(throwingStorage())).toBeNull()
  })

  it('запись best-effort при кидающем storage — глотает, не роняет вызывающего', () => {
    expect(() => writeStoredTransport(throwingStorage())).not.toThrow()
  })
})

describe('resolveInitialTransport [ID:P-hybrid]', () => {
  it('дефолт: пустой query + пустой storage → iframe', () => {
    expect(resolveInitialTransport(null, memStorage())).toBe('iframe')
  })

  it('?transport=native побеждает даже без персистентного выбора', () => {
    expect(resolveInitialTransport('native', memStorage())).toBe('native')
  })

  it('персистентный выбор этой сессии (без query) → native', () => {
    const s = memStorage()
    writeStoredTransport(s)
    expect(resolveInitialTransport(null, s)).toBe('native')
  })

  it('незнакомое значение query игнорируется — падает на storage/дефолт', () => {
    expect(resolveInitialTransport('bogus', memStorage())).toBe('iframe')
    const s = memStorage()
    writeStoredTransport(s)
    expect(resolveInitialTransport('bogus', s)).toBe('native') // bogus НЕ трогает персист
  })

  // Аудит MED-3/5b [ID:P-hybrid-audit]: ?transport=iframe — принудительный
  // откат, ЧИСТИТ sessionStorage (иначе следующий шаг маршрута без параметра
  // снова открылся бы native — залипание без пути назад).
  it('?transport=iframe перекрывает персистентный native И чистит sessionStorage', () => {
    const s = memStorage()
    writeStoredTransport(s)
    expect(resolveInitialTransport('iframe', s)).toBe('iframe')
    expect(s.getItem(TRANSPORT_STORAGE_KEY)).toBeNull()
    expect(resolveInitialTransport(null, s)).toBe('iframe') // залипание снято
  })
})

describe('clearStoredTransport [ID:P-hybrid-audit]', () => {
  it('снимает персистентный выбор (write → clear → read=null)', () => {
    const s = memStorage()
    writeStoredTransport(s)
    clearStoredTransport(s)
    expect(readStoredTransport(s)).toBeNull()
    expect(s.getItem(TRANSPORT_STORAGE_KEY)).toBeNull()
  })

  it('best-effort при кидающем storage — глотает, не роняет вызывающего', () => {
    expect(() => clearStoredTransport(throwingStorage())).not.toThrow()
  })
})
