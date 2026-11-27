// shadow-partial.test.ts — Срез D: мутационно-тестируемый фильтр «живого партиала»
// по армленному упражнению. Вынесен из PlayerPage АДДИТИВНО (тот же идиом, что
// shadow-phase.ts/shadow-attempts-accumulate.ts), потому что полный React-mount
// PlayerPage (с замоканными useShadowRuntime/useShadowMicStream) не может гнать
// реальные партиалы источника через фильтр — а чистая функция даёт РЕАЛЬНУЮ,
// детерминированную мутационную проверку «чужой партиал не утекает».
import { describe, it, expect } from 'vitest'
import { acceptArmedPartial } from '../shadow-partial'

describe('acceptArmedPartial — фильтр по армленному exerciseId (Срез D)', () => {
  it('принимает партиал, чей exerciseId совпадает с армленным', () => {
    expect(acceptArmedPartial('ex1', 'ex1', 'the quick brown')).toBe('the quick brown')
  })

  // МУТАЦИОННЫЙ гейт: убери проверку равенства exerciseId → этот тест краснеет.
  // Быстрый re-arm / stale-сессия: партиал старого/чужого упражнения НЕ утекает.
  it('ОТКЛОНЯЕТ (null) партиал от ДРУГОГО упражнения (чужая/стейл сессия)', () => {
    expect(acceptArmedPartial('exOLD', 'exNEW', 'старый партиал')).toBeNull()
  })

  it('ОТКЛОНЯЕТ партиал, когда ничего не армлено (armed=null)', () => {
    expect(acceptArmedPartial('ex1', null, 'осиротевший партиал')).toBeNull()
  })

  // Пустой партиал для армленного упражнения — ЛЕГИТИМНОЕ «принять пустую строку»
  // (сессия очистила интерим), отличается от reject-null. Возвращаем '' (не null).
  it('принимает пустой партиал ("") для армленного упражнения — отличимо от reject-null', () => {
    expect(acceptArmedPartial('ex1', 'ex1', '')).toBe('')
  })
})
