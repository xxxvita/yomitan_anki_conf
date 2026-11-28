// ReplaceConfirm.tsx — строка подтверждения «Заменить» (спека 2026-11-17 §4.6,
// §4.12; текст утверждён, O3). Замена сносит весь план дня и необратима, поэтому
// одно нажатие ничего не шлёт: под кнопкой — строка с [Заменить] [Отмена], без
// модального окна. «Отмена» ничего не шлёт.
export function ReplaceConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="confirm" role="group" aria-label="Подтверждение замены" data-testid="replace-confirm">
      <p>Маршрут подберёт новый набор роликов на сегодня. Заменить?</p>
      <div className="row">
        <button type="button" className="btn danger sm" onClick={onConfirm}>Заменить</button>
        <button type="button" className="btn sm" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  )
}
