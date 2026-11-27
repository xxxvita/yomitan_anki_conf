// Форматы экранов: число с разрядами языка интерфейса, дата «дд.мм» (с годом, если он не текущий), длительность.
import type { Lang } from '../i18n'

export const fmtNum = (lang: Lang, n: number) => n.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '?'
  const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return d.getFullYear() === new Date().getFullYear() ? dm : `${dm}.${d.getFullYear()}`
}

export function splitDuration(sec: number): { m: number; s: number } {
  const t = Math.max(0, Math.round(sec))
  return { m: Math.floor(t / 60), s: t % 60 }
}
