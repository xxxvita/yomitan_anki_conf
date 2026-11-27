// brand.ts — бренд сайта по домену (решение владельца 2026-11-17).
//
// Один и тот же сайт открыт на flib.club и flibooster.ru. На flibooster.ru
// (и www.) покупатель должен видеть «Flibooster», а не чужое имя — во вкладке
// и в логотипе. index.html по умолчанию держит «flib.club», здесь бренд
// подменяется при старте (main.tsx) и в BrandMark. Правило — ОДНО, в
// siteBrand(): заголовок и логотип не могут разойтись.
export type SiteBrand = 'Flibooster' | 'flib.club'

const DEFAULT_BRAND: SiteBrand = 'flib.club'
const FLIBOOSTER_HOSTS = new Set(['flibooster.ru', 'www.flibooster.ru'])

function currentHostname(): string {
  return typeof window !== 'undefined' ? window.location.hostname : ''
}

export function siteBrand(hostname: string = currentHostname()): SiteBrand {
  // Точное совпадение, а не endsWith: evil-flibooster.ru — не мы.
  const h = hostname.toLowerCase().replace(/\.$/, '')
  return FLIBOOSTER_HOSTS.has(h) ? 'Flibooster' : DEFAULT_BRAND
}

// brandTitle меняет только бренд в начале заголовка из index.html; хвост
// остаётся дословным. Заголовок без бренда в начале не трогается.
export function brandTitle(title: string, hostname: string = currentHostname()): string {
  if (!title.startsWith(DEFAULT_BRAND)) return title
  return siteBrand(hostname) + title.slice(DEFAULT_BRAND.length)
}

export function applyBrandTitle(doc: Document = document, hostname: string = currentHostname()): void {
  doc.title = brandTitle(doc.title, hostname)
}
