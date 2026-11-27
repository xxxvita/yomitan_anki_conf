// GoalChips.tsx — общие чипы-мультивыбор целей ("что хочешь понимать").
//
// docs/plan-2026-07-13-design-transfer.md, Э3 п.4: вынесено из TryPage.tsx
// (было заинлайнено в Э1) в общий компонент, потому что ImportPage.tsx тоже
// требует цель — без неё маршруту (POST /api/route goal_ids) нечего строить
// для точки А из импортированного словаря (kind='words' сам по себе цели не
// несёт, см. pointA.ts:PointAWords.goals). Список целей — проп, а не читается
// компонентом из data.ts напрямую: TryPage грузит его из fetchGoals() с
// фолбэком (Э3 п.4а), ImportPage — не грузит (задача этого не требует),
// компонент не должен знать, откуда список пришёл.
export interface GoalChipItem {
  id: string
  title: string
}

interface GoalChipsProps {
  goals: GoalChipItem[]
  selected: string[]
  onToggle: (id: string) => void
}

export function GoalChips({ goals, selected, onToggle }: GoalChipsProps) {
  return (
    <div className="chip-row">
      {goals.map(g => (
        <button
          key={g.id}
          type="button"
          className={`chip ${selected.includes(g.id) ? 'on' : ''}`}
          aria-pressed={selected.includes(g.id)}
          onClick={() => onToggle(g.id)}
        >
          {g.title}
        </button>
      ))}
    </div>
  )
}
