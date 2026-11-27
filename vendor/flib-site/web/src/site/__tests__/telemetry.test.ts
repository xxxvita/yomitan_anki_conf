// telemetry.test.ts — клиентский транспорт поведенческой телеметрии плеера:
// буфер в памяти, батч-флаш fetch(keepalive) на интервале/по достижении cap,
// терминальный флаш через navigator.sendBeacon(Blob application/json) на
// pagehide/visibilitychange. Fire-and-forget: ошибки глотаются, без ретраев.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  track,
  flushTelemetry,
  subLineHash,
  onTerminalFlush,
  TELEMETRY_SCHEMA_VERSION,
  __resetTelemetryForTests,
  __telemetryBufferSize,
  TELEMETRY_MAX_BUFFER,
} from '../telemetry'

beforeEach(() => {
  __resetTelemetryForTests()
})
afterEach(() => {
  __resetTelemetryForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>): any {
  const call = fetchMock.mock.calls.at(-1)!
  return JSON.parse(call[1].body)
}

describe('track + flushTelemetry', () => {
  it('POSTs {events:[…]} with the base schema merged over the payload, keepalive:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    track('video_open', { video_id: 'abc123', route_goal: 'friends', ttff_ms: 842 })
    flushTelemetry()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/telemetry/events')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(init.body)
    expect(body.events).toHaveLength(1)
    const ev = body.events[0]
    expect(ev.event).toBe('video_open')
    expect(ev.video_id).toBe('abc123')
    expect(ev.route_goal).toBe('friends')
    expect(ev.ttff_ms).toBe(842)
    expect(typeof ev.anon_id).toBe('string')
    expect(ev.anon_id.length).toBeGreaterThan(0)
    expect(typeof ev.ts_client).toBe('number')
    expect(ev.schema_version).toBe(TELEMETRY_SCHEMA_VERSION)
    expect(ev.tier).toBe('web_anon')
  })

  it('base fields cannot be spoofed by the payload (base wins on key collision)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    // malicious/buggy payload tries to override identity fields
    track('word_click', { event: 'evil', anon_id: 'spoofed', tier: 'admin', surface_form: 'bridge' })
    flushTelemetry()
    await Promise.resolve()

    const ev = lastFetchBody(fetchMock).events[0]
    expect(ev.event).toBe('word_click')
    expect(ev.anon_id).not.toBe('spoofed')
    expect(ev.tier).toBe('web_anon')
    expect(ev.surface_form).toBe('bridge') // non-base field still passes through
  })

  it('flushing an empty buffer does not hit the network', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    flushTelemetry()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drains the buffer after a flush (second flush is a no-op)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    track('rewind', { from_time: 30, to_time: 10 })
    expect(__telemetryBufferSize()).toBe(1)
    flushTelemetry()
    expect(__telemetryBufferSize()).toBe(0)
    flushTelemetry()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('auto-flushes when the buffer hits the cap (bounded memory)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < TELEMETRY_MAX_BUFFER; i++) {
      track('watch_progress', { seq: i })
    }
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1) // cap reached → forced flush
    expect(__telemetryBufferSize()).toBe(0)
    expect(lastFetchBody(fetchMock).events).toHaveLength(TELEMETRY_MAX_BUFFER)
  })

  it('swallows network errors (rejects → console.warn, never throws)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    track('rate_change', { rate: 0.5 })
    expect(() => flushTelemetry()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('terminal flush via sendBeacon', () => {
  it('pagehide flushes the buffer through navigator.sendBeacon as an application/json Blob', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    track('watch_progress', { watched_pct: 0.42, current_time: 50 })
    window.dispatchEvent(new Event('pagehide'))

    expect(beacon).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled() // terminal path must NOT use fetch
    const [url, blob] = beacon.mock.calls[0]
    expect(url).toBe('/api/telemetry/events')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/json')
    // jsdom Blob lacks .text() and isn't readable by undici Response; jsdom's
    // own FileReader reads its own Blob impl.
    const text: string = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(fr.error)
      fr.readAsText(blob)
    })
    const parsed = JSON.parse(text)
    expect(parsed.events[0].watched_pct).toBe(0.42)
    expect(__telemetryBufferSize()).toBe(0)
  })

  it('visibilitychange→hidden triggers a beacon flush', () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })

    track('video_open', { video_id: 'v1' })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('runs terminal-flush hooks BEFORE draining, so a last-moment event rides the same beacon', async () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })

    // hook emits a final event synchronously at teardown
    const off = onTerminalFlush(() => track('watch_progress', { watched_pct: 0.9, final: true }))
    track('video_open', { video_id: 'v1' })
    window.dispatchEvent(new Event('pagehide'))

    expect(beacon).toHaveBeenCalledTimes(1)
    const [, blob] = beacon.mock.calls[0]
    const text: string = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(fr.error)
      fr.readAsText(blob)
    })
    const events = JSON.parse(text).events
    // BOTH the pre-existing event and the hook-emitted final event are in the beacon
    expect(events.map((e: any) => e.event)).toEqual(['video_open', 'watch_progress'])
    expect(events[1].final).toBe(true)
    off()
  })

  it('onTerminalFlush returns an unsubscribe that stops the hook firing', () => {
    const beacon = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beacon })
    const hook = vi.fn()
    const off = onTerminalFlush(hook)
    off()
    window.dispatchEvent(new Event('pagehide'))
    expect(hook).not.toHaveBeenCalled()
  })

  it('does not throw when sendBeacon returns false (queue full — no retry)', () => {
    vi.stubGlobal('navigator', { sendBeacon: vi.fn().mockReturnValue(false) })
    track('step_completed', { step_index: 2 })
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
    expect(__telemetryBufferSize()).toBe(0) // drained regardless (fire-and-forget)
  })
})

describe('subLineHash', () => {
  it('is deterministic for identical text', () => {
    expect(subLineHash('A view from the bridge')).toBe(subLineHash('A view from the bridge'))
  })
  it('differs for different text', () => {
    expect(subLineHash('hello world')).not.toBe(subLineHash('goodbye world'))
  })
  it('ignores surrounding whitespace (content hash, not byte hash)', () => {
    expect(subLineHash('  the same line  ')).toBe(subLineHash('the same line'))
  })
  it('returns an 8-char lowercase hex string', () => {
    expect(subLineHash('anything at all')).toMatch(/^[0-9a-f]{8}$/)
  })
  it('is STABLE across releases (golden value — a change to the FNV constants would silently break joins against all historical JSONL)', () => {
    expect(subLineHash('A view from the bridge')).toBe('2b828d85')
  })
})
