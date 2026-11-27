// WEB-SEAM: независимый кламп левого/правого края cue-блока по exercise-паттерну
// панели (WorkspacePanelThemed.tsx:1298-1300). Наивный min(100,width) искажает
// ПРАВЫЙ край (l=98,w=10 → right=108, вылазит за таймлайн). Правильно: клампить
// оба края независимо, ширину выводить из разности. Десктопу тот же баг —
// отдельный upstream-фикс позже, в этот спринт НЕ входит.
// W1c: границы сужены с -2..104 до 0..100 — десктопный exercise-свес нам не
// нужен, а 104% стал видим на широком лейауте (скриншот владельца, фидбек №4).
export interface ClampedEdges {
  left: number;
  width: number;
}

export function clampCueEdges(leftPct: number, widthPct: number): ClampedEdges {
  // W1c: правый край ≤100. fb#6: ДОБАВЛЕНА верхняя граница left ≤ 100−minWidth(0.3),
  // иначе окно 100..105 рендерилось за краем плеера (карточка на left:103%, скриншот
  // владельца f_13). Клампим ОБА края независимо; сливер 0.3% всегда на канве.
  const MAX_LEFT = 100 - 0.3;
  const leftClamped = Math.min(Math.max(0, leftPct), MAX_LEFT);
  const rightClamped = Math.min(100, leftPct + widthPct);
  const width = Math.max(0.3, rightClamped - leftClamped);
  return { left: leftClamped, width };
}
