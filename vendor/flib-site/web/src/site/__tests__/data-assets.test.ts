// data-assets.test.ts — фоновые кадры клипов не должны ссылаться на /img/:
// этот путь BFF отдаёт лендингу шлюза (bff.LandingPaths), и картинки сайта
// там отвечали 404 (прод, 2026-11-19). Кадры импортируются из web/src —
// Vite выдаёт их как /assets/<имя>-<hash>.png. Серверный сторож всего
// web/public — public_assets_test.go.
import { describe, it, expect } from 'vitest'
import { CLIPS } from '../data'

describe('кадры клипов', () => {
  it('не лежат под путём лендинга /img/', () => {
    expect(CLIPS.length).toBeGreaterThan(0)
    for (const c of CLIPS) {
      expect(c.bg).not.toMatch(/^\/img\//)
      expect(c.bg).toMatch(new RegExp(`clip-${c.id === 'phm' ? 'phm' : 'zootopia'}.*\\.png`))
    }
  })
})
