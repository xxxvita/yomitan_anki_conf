// NoDayView.tsx — «Начат, дня нет, обмена нет» (спека 2026-11-17 §4.3, I10):
// повтор обмена или сброс и другая цель; причина — последний error_code, если он
// известен в этой вкладке.
export function NoDayView({ code, busy, onRetry, onReset }: { code: string | null; busy: boolean; onRetry: () => void; onReset: () => void }) {
  return (
    <div className="done-card">
      <h2>Не удалось подобрать ролики.</h2>
      {code && <span className="mono">Причина: {code}</span>}
      <div className="hero-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={onRetry}>Попробовать ещё раз</button>
        <button type="button" className="btn" disabled={busy} onClick={onReset}>Сбросить и выбрать другую цель</button>
      </div>
    </div>
  )
}
