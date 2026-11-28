// keepalive-budget.ts — общий бюджет запросов `keepalive` страницы (повторное
// ревью партии 2, R-L1).
//
// Браузер ограничивает не каждый keepalive-запрос, а СУММУ тел запросов в полёте
// (64 КиБ в Chromium): замер — 2 + 4 + 58 КиБ проходят, 2 + 4 + 60 КиБ — третий
// отвергнут («Failed to fetch»). Одна выгрузка страницы шлёт до трёх таких
// запросов: очередь событий, `PUT progress`, очередь ещё раз (с отчётом ролика).
// Поэтому все они берут место из одного счётчика; место возвращается, когда
// запрос завершился. Квота — 60 КиБ (запас под заголовки и округления).
export const KEEPALIVE_QUOTA_BYTES = 60 << 10

const enc = new TextEncoder()

export type KeepaliveFetch = (url: string, init: RequestInit) => Promise<Response>

export class KeepaliveBudget {
  private inflight = 0
  constructor(readonly quota: number = KEEPALIVE_QUOTA_BYTES) {}

  // room — сколько байт тела ещё можно отправить keepalive прямо сейчас.
  room(): number { return Math.max(0, this.quota - this.inflight) }

  // send — отправить keepalive, если тело помещается в оставшееся место; false —
  // не отправлено (браузер всё равно отверг бы запрос).
  send(fetchFn: KeepaliveFetch, url: string, init: RequestInit): boolean {
    const body = typeof init.body === 'string' ? init.body : ''
    const n = enc.encode(body).length
    if (n > this.room()) return false
    this.inflight += n
    let released = false
    const release = () => { if (!released) { released = true; this.inflight -= n } }
    try {
      void Promise.resolve(fetchFn(url, { ...init, keepalive: true })).then(release, release)
    } catch {
      release()
      return false
    }
    return true
  }
}

// pageKeepalive — бюджет этой страницы: общий для очереди событий и прогресса.
export const pageKeepalive = new KeepaliveBudget()
