// storage-probe.ts — проверка «секрет не попал в хранилища браузера» для тестов
// покупки. {...localStorage} тут не годится: под Node 26 localStorage — полифилл
// из vitest.setup.ts, и спред даёт его внутреннее поле, а не записи. Поэтому
// перебираем через length/key/getItem и вдобавок шпионим за setItem (запись
// могли сделать и удалить — содержимое на момент проверки этого не покажет).
import { vi, type MockInstance } from 'vitest'

function stores(): Storage[] {
  return [window.localStorage, window.sessionStorage]
}

export function storageText(): string {
  const out: string[] = []
  for (const s of stores()) {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k != null) out.push(k, s.getItem(k) ?? '')
    }
  }
  return out.join('\n')
}

// Шпион ставится на прототип: у jsdom-хранилища собственное свойство
// «setItem» стало бы записью в хранилище, а не подменой метода.
export function spyStorageWrites(): MockInstance[] {
  const protos = [...new Set(stores().map(s => Object.getPrototypeOf(s) as Storage))]
  return protos.map(p => vi.spyOn(p, 'setItem'))
}

// leaked — секреты, найденные в содержимом хранилищ или в аргументах setItem.
export function leaked(spies: MockInstance[], secrets: string[]): string[] {
  const written = spies.flatMap(sp => sp.mock.calls.map(c => c.join('='))).join('\n')
  const now = storageText()
  return secrets.filter(sec => now.includes(sec) || written.includes(sec))
}
