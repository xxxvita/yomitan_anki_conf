// external-links.test.ts — контакты проекта в ОДНОМ месте (решение владельца
// 2026-11-16 «Везде как на /buy»): канал @flibclub, поддержка
// @FliboosterHelpUser_bot. Функциональный бот @flibclub_bot (демо-ключ,
// привязка Telegram к ключу) остаётся своим адресом.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL, TELEGRAM_BOT_URL, TELEGRAM_CHANNEL_HANDLE, TELEGRAM_CHANNEL_URL,
} from '../external-links'

const SITE = join(process.cwd(), 'src/site')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : []
  })
}

describe('внешние ссылки', () => {
  it('канал @flibclub, поддержка @FliboosterHelpUser_bot, функциональный бот @flibclub_bot', () => {
    expect(TELEGRAM_CHANNEL_HANDLE).toBe('flibclub')
    expect(TELEGRAM_CHANNEL_URL).toBe('https://t.me/flibclub')
    expect(SUPPORT_BOT_HANDLE).toBe('FliboosterHelpUser_bot')
    expect(SUPPORT_BOT_URL).toBe('https://t.me/FliboosterHelpUser_bot')
    expect(TELEGRAM_BOT_URL).toBe('https://t.me/flibclub_bot')
  })

  it('страницы не держат свои адреса t.me — только константы external-links.ts', () => {
    // billing-api.ts — проверка формы диплинка tg_link_url (регулярное
    // выражение), это не ссылка для показа.
    const allowed = new Set(['external-links.ts', 'billing-api.ts'])
    const found: string[] = []
    for (const file of sources(SITE)) {
      const rel = relative(SITE, file)
      if (allowed.has(rel)) continue
      readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        if (/t\.me\b|flibclcub|flibclub_bot|FliboosterHelpUser_bot/i.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    expect(found).toEqual([])
  })

  it.each([['BuyPage.tsx'], ['OrderPage.tsx'], ['LoginModal.tsx']])('%s берёт контакты из external-links.ts', (name) => {
    expect(readFileSync(join(SITE, name), 'utf-8')).toMatch(/from '\.\/external-links'/)
  })
})
