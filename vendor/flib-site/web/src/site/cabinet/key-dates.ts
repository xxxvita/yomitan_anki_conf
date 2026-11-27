// key-dates.ts — срок ключа для шапки и профиля кабинета.
// «24 ноября» (год — только если не текущий) и «24.11». Неразборная дата → null:
// строку срока тогда не показываем вовсе (как у бессрочного ключа).
function parse(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function untilLong(iso: string | null, now: Date = new Date()): string | null {
  const d = parse(iso)
  if (!d) return null
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts).replace(/\s*г\.$/, '')
}

export function untilShort(iso: string | null): string | null {
  const d = parse(iso)
  if (!d) return null
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// Куда ведёт «Продлить» в кабинете (спека §3.8): блок продления на /buy.
export const RENEW_HREF = '/buy#renew'
