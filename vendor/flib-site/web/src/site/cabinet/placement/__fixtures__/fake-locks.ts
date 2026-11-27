// Подделка navigator.locks: ifAvailable-замки в памяти, освобождение — когда обработчик вернул/завершил промис.
// defer: запрос ждёт grant() — позднее предоставление замка (отмена открытия между запросом и выдачей).
export function fakeLocks(opts: { defer?: boolean } = {}) {
  const held = new Set<string>()
  const log: string[] = []
  let open!: () => void
  const gate = new Promise<void>((r) => { open = r })
  const api = {
    held,
    log,
    grant: () => open(),
    async request(name: string, _opts: { ifAvailable?: boolean }, cb: (lock: unknown) => unknown): Promise<unknown> {
      if (opts.defer) await gate
      if (held.has(name)) {
        log.push(`busy ${name}`)
        return cb(null)
      }
      held.add(name)
      log.push(`grant ${name}`)
      try { return await cb({ name }) } finally { held.delete(name); log.push(`release ${name}`) }
    },
  }
  return api as unknown as LockManager & { held: Set<string>; log: string[]; grant: () => void }
}
