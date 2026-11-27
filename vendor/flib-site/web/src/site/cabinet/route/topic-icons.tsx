// topic-icons.tsx — иконки 14 тем экрана старта маршрута v2 (дизайн 2026-11-19,
// docs/design/cabinet-2026-11-19/src/cab/cab-start.jsx, cabTopicIcon). Ключи —
// ключи категорий сайта (GOAL_CATEGORIES в data.ts): тот же порядок, что в макете.
import type { ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  science: <><circle cx="12" cy="12" r="1.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" /></>,
  'it-courses': <><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M14 4l-4 16" /></>,
  'news-politics': <><rect x="3" y="5" width="18" height="14" /><path d="M7 9h10M7 13h10M7 17h6" /></>,
  'news-sports': <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  everyday: <><path d="M4 5h16v11H9l-5 4z" /></>,
  business: <><rect x="3" y="7" width="18" height="13" /><path d="M9 7V4h6v3M3 12h18" /></>,
  beginners: <><path d="M12 21v-9" /><path d="M12 12c0-4 3-7 8-7 0 5-3 7-8 7z" /><path d="M12 14c0-3-2-5-7-5 0 4 2 5 7 5z" /></>,
  docs: <><rect x="3" y="4" width="18" height="16" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  standup: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  cooking: <><path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M2 10h20M9 6c0-1 1-2 1-3M14 6c0-1 1-2 1-3" /></>,
  travel: <><path d="M10 14l-7-3 2-2 7 1 5-5a2 2 0 0 1 3 3l-5 5 1 7-2 2-3-7-3 3v3l-2 1-1-4-4-1 1-2h3z" /></>,
  religion: <><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" /></>,
  pronunciation: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" /></>,
}

export function TopicIcon({ k }: { k: string }) {
  const d = P[k]
  if (!d) return null
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">{d}</svg>
  )
}
