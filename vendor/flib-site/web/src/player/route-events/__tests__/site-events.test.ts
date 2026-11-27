// site-events.test.ts — фикстуры событий сайта для теста шлюза Г3 (план B8a,
// спека §8 «Золотые фикстуры», §11 Г3): файл в репозитории равен тому, что
// генерирует настоящий код сопоставления; набор полон (7 родов, 17 имён),
// event_id уникальны, у каждого события есть learning_day и client_ts RFC 3339.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSiteEventFixtures, serializeFixtures, REQUIRED_CASES, type FixtureFile } from '../__fixtures__/generate'

// vitest запускается из web/ (package.json); import.meta.url под jsdom не file:.
const FILE = resolve(process.cwd(), 'src/player/route-events/__fixtures__/site-events.json')

describe('site-events.json', () => {
  it('совпадает с тем, что генерирует код сопоставления', () => {
    if (process.env.UPDATE_SITE_FIXTURES === '1') {
      let commit = process.env.SITE_COMMIT ?? ''
      if (!commit) {
        try { commit = (JSON.parse(readFileSync(FILE, 'utf8')) as FixtureFile).site_commit } catch { commit = 'unknown' }
      }
      writeFileSync(FILE, serializeFixtures(buildSiteEventFixtures(commit)))
    }
    const raw = readFileSync(FILE, 'utf8')
    const file = JSON.parse(raw) as FixtureFile
    expect(raw).toBe(serializeFixtures(buildSiteEventFixtures(file.site_commit)))
  })

  it('полнота: ровно семь родов сайта, все 17 обязательных имён, уникальные event_id', () => {
    const file = JSON.parse(readFileSync(FILE, 'utf8')) as FixtureFile
    expect(file.v).toBe(1)
    expect(file.site_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(new Set(file.cases.map(c => c.kind))).toEqual(new Set([
      'clip_played', 'subtitles_shown', 'hint_requested', 'line_translated', 'clip_replayed', 'clipboard_copy', 'clip_rated',
    ]))
    const names = file.cases.map(c => c.name)
    for (const n of REQUIRED_CASES) expect(names).toContain(n)
    expect(new Set(names).size).toBe(names.length)
    const ids = file.cases.map(c => c.event.event_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of file.cases) {
      expect(c.event.type).toBe(c.kind)
      expect(c.event.event_id.startsWith('web:')).toBe(true)
      expect(c.event.learning_day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.event.client_ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
    }
  })

  it('голого dislike без причины генератор не производит; деградированный — partial без lemmas и > 16 КиБ', () => {
    const file = JSON.parse(readFileSync(FILE, 'utf8')) as FixtureFile
    for (const c of file.cases) if (c.kind === 'clip_rated' && c.event.rating === 'dislike') expect(typeof c.event.rate_reason).toBe('string')
    const deg = file.cases.find(c => c.name === 'clip_played/degraded_partial')!.event
    expect(deg.subs_report).toBe('partial')
    expect((deg.subs_heard as Array<Record<string, unknown>>).some(h => 'lemmas' in h)).toBe(false)
    const len = new TextEncoder().encode(JSON.stringify(deg)).length
    expect(len).toBeGreaterThan(16 * 1024)
    expect(len).toBeLessThanOrEqual(240 * 1024)
  })
})
