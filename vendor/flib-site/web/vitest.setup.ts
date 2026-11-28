// Глобальный vitest setup: авто-размонтирование React-деревьев между тестами.
// В репо globals:false → afterEach/cleanup импортируем явно. Снимает DOM-bleed и
// коллизии одинаковых data-testid для всех render-тестов (без per-file afterEach).
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { __resetVideoTitlesForTests } from './src/site/cabinet/route/use-video-titles'

// jsdom 25.x не реализует PointerEvent (добавлено только в jsdom 27+) — fireEvent.pointerDown/
// Move/Up падают обратно на голый Event и молча теряют clientX/pointerId. Минимальный полифилл
// поверх MouseEvent (несёт clientX/clientY) — только для тестовой среды, логику компонентов не трогает.
// typeof MouseEvent — тесты с `@vitest-environment node` (например, сторож
// vite.config.ts: esbuild внутри vite не работает под jsdom) DOM не имеют.
if (typeof globalThis.PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }
  // @ts-expect-error — полифилл для jsdom, не полная реализация PointerEvent
  globalThis.PointerEvent = PointerEventPolyfill
}

// jsdom не реализует ResizeObserver (используется WorkspacePanelThemed для barWidth
// live-layout, P1 T3 lift). Минимальный no-op стаб — тесты не проверяют реальный
// resize-driven layout, только что рендер не падает.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe() { /* no-op in jsdom */ }
    unobserve() { /* no-op in jsdom */ }
    disconnect() { /* no-op in jsdom */ }
  }
  // @ts-expect-error — полифилл для jsdom, не полная реализация ResizeObserver
  globalThis.ResizeObserver = ResizeObserverPolyfill
}

// Node 22+ ships its own global `localStorage` getter (needs --localstorage-file
// to back it) which shadows jsdom's real Storage: `'localStorage' in globalThis`
// is true, so vitest's jsdom environment (populateGlobal) skips copying jsdom's
// window.localStorage over it, leaving `globalThis.localStorage === undefined`.
// A7 (useMuteRegions) is the first code path to actually read/write localStorage
// in a test — minimal in-memory Storage polyfill, same convention as the
// PointerEvent/ResizeObserver gaps above.
if (typeof globalThis.localStorage === 'undefined') {
  class LocalStoragePolyfill implements Storage {
    private store = new Map<string, string>()
    get length() { return this.store.size }
    clear() { this.store.clear() }
    getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
    key(index: number) { return Array.from(this.store.keys())[index] ?? null }
    removeItem(key: string) { this.store.delete(key) }
    setItem(key: string, value: string) { this.store.set(key, String(value)) }
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: new LocalStoragePolyfill(), configurable: true, enumerable: true,
  })
}

// jsdom does not implement URL.createObjectURL/revokeObjectURL (no Blob-backed
// object URL registry). T3 (useShadowV1) is the first code path to mint a blob
// URL for the recorded WAV in a test — minimal counter-based stub, same
// convention as the polyfills above. Tests only assert on presence/shape of the
// returned string, never resolve it as a real resource.
// T3 review (finding #3, unmount-revoke regression test): both are vi.fn() spies
// (not bare functions) so individual tests can assert call counts/args — e.g.
// "unmount revokes the current recordAudioUrl" needs to see revokeObjectURL was
// actually invoked, and the generation-guard test needs to see createObjectURL
// was NOT invoked again for a discarded (deactivated mid-flight) finalize.
if (typeof globalThis.URL.createObjectURL === 'undefined') {
  let counter = 0
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${++counter}`)
  globalThis.URL.revokeObjectURL = vi.fn()
}

afterEach(() => { cleanup(); __resetVideoTitlesForTests() })
