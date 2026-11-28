import { useEffect, useState } from 'react'

const QUERY = '(pointer: coarse)'

// [ID:P-mobile] — единственный JS-детектор "мобильного" UX в плеере. НЕ
// UA-сниффинг (владелец: адаптив вместо отдельного мобильного сабдомена/
// бандла — localStorage per-origin порвал бы A/B). matchMedia('(pointer:
// coarse)') отражает РЕАЛЬНЫЙ способ ввода (тач vs мышь/трекпад), а не
// строку user-agent, которую легко подделать/забыть обновить. jsdom в тестах
// НЕ реализует window.matchMedia вовсе (typeof === 'undefined') — оба хелпера
// ниже фолбэкают на false в этом случае, поэтому ЛЮБОЙ существующий тест, не
// замокавший matchMedia явно, продолжает видеть десктопное поведение
// (mobile=false) без единой правки — это и есть гарантия "десктоп не тронут".
export function prefersCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(prefersCoarsePointer)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = () => setCoarse(mql.matches)
    // Safari<14 / некоторые тестовые моки не несут addEventListener на
    // MediaQueryList — addListener/removeListener фолбэк (тот же паттерн,
    // что уже используют другие вендор-специфичные API в этом кодбейзе).
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
    else if (typeof mql.addListener === 'function') mql.addListener(onChange)
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange)
    }
  }, [])
  return coarse
}
