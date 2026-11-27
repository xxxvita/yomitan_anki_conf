// AwaitingEvaluationOverlay.test.tsx — T-A (A3/A5): CSS-fade (no framer-motion)
// + i18n seam (useI18n → useLocale). See task-A-brief.md A3.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AwaitingEvaluationOverlay } from '../AwaitingEvaluationOverlay'
import { setLocale } from '../../i18n'

afterEach(() => { setLocale('ru') })

describe('AwaitingEvaluationOverlay', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<AwaitingEvaluationOverlay visible={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('visible=true fades in to opacity 1 via a plain CSS transition (no framer-motion)', () => {
    const { container } = render(<AwaitingEvaluationOverlay visible={true} />)
    const root = container.firstElementChild as HTMLElement
    expect(root).not.toBeNull()
    expect(root.style.opacity).toBe('1')
    expect(root.style.transition).toContain('opacity 0.18s')
  })

  it('takes the language via useLocale (RTL: setLocale drives the copy)', () => {
    setLocale('ru')
    const ru = render(<AwaitingEvaluationOverlay visible={true} />)
    expect(screen.getByText('Анализ ответа…')).toBeTruthy()
    ru.unmount()

    setLocale('en')
    render(<AwaitingEvaluationOverlay visible={true} />)
    expect(screen.getByText('Analyzing answer…')).toBeTruthy()
  })

  it('does not import framer-motion (no such dependency in web/package.json)', () => {
    // process.cwd() is `web/` — vitest.config.ts / package.json both live there.
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(allDeps['framer-motion']).toBeUndefined()

    // The WEB-SEAM comment in the source legitimately mentions "framer-motion"
    // by name (documenting the seam) — assert there's no actual import of it,
    // not that the substring is absent everywhere.
    const source = readFileSync(
      resolve(process.cwd(), 'src/player/components/AwaitingEvaluationOverlay.tsx'),
      'utf-8',
    )
    expect(source).not.toMatch(/from\s+['"]framer-motion['"]/)
  })
})
