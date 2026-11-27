// usePlayerTheme — применяет Dusk cssVars ИНЛАЙН, scoped на root-элемент плеера
// (не :root, без префикса). Возвращает CALLBACK-REF `themeRef`: применяет vars в
// МОМЕНТ прикрепления узла (устраняет пропуск при late/conditional mount, где
// обычный useEffect([ref]) не перезапустился бы). Смена variant меняет identity
// themeRef → React ре-вызывает ref на том же узле → применяет свежие vars.
import { useCallback, useState } from 'react'
import { getPlayerTheme, type DuskVariant, type PlayerTheme } from './player-theme'

const KEY = 'flib:dusk-variant'
const DEFAULT: DuskVariant = 'site'

function loadVariant(): DuskVariant {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'site' || v === 'refined' || v === 'indigo' || v === 'mono') return v
  } catch { /* ignore */ }
  return DEFAULT
}

function applyVars(el: HTMLElement, theme: PlayerTheme) {
  for (const [k, v] of Object.entries(theme.cssVars ?? {})) el.style.setProperty(k, v)
}

export function usePlayerTheme() {
  const [variant, setVariantState] = useState<DuskVariant>(loadVariant)
  const theme = getPlayerTheme(variant)
  const themeRef = useCallback((el: HTMLElement | null) => {
    if (el) applyVars(el, theme) // применяем ровно когда узел прикрепился / при смене темы
  }, [theme])
  const setVariant = (v: DuskVariant) => {
    setVariantState(v)
    try { localStorage.setItem(KEY, v) } catch { /* ignore */ }
  }
  return { theme, variant, setVariant, themeRef }
}
