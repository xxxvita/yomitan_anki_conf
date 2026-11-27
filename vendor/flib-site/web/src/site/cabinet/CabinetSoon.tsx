// CabinetSoon.tsx — раздел кабинета, которого ещё нет: «Маршрут» до PR-B,
// «Мои знания» (решение владельца 2026-11-18). Заголовок раздела и «скоро».
export function CabinetSoon({ title }: { title: string }) {
  return (
    <div className="ph">
      <span className="mono">{title}</span>
      <h1><em>Скоро</em></h1>
      <p>Раздел в работе.</p>
    </div>
  )
}
