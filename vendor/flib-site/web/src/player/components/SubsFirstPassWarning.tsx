// SubsFirstPassWarning — предупреждение при включении субтитров на первом
// просмотре ролика маршрута (спека кабинета 2026-11-17 §4.7 п.2). «Хорошо» —
// субтитры остаются скрытыми; «Всё равно показать» — согласие на этот ролик,
// строки появляются размытыми.
export function SubsFirstPassWarning({ onKeep, onShow }: { onKeep: () => void; onShow: () => void }) {
  return (
    <div className="subs-first-pass-warning" role="dialog" aria-modal="true" data-testid="subs-first-pass-warning"
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <p>На первом просмотре субтитры мешают учиться слушать</p>
      <div className="sfpw-actions">
        <button type="button" className="tb-btn" data-testid="subs-warning-keep" onClick={onKeep}>Хорошо</button>
        <button type="button" className="tb-btn" data-testid="subs-warning-show" onClick={onShow}>Всё равно показать</button>
      </div>
    </div>
  )
}
