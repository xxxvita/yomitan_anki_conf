// PlacementLink.tsx — ссылка на страницу теста уровня. В роутере — клиентский переход; вне роутера
// (отдельная отрисовка страницы в тестах) — обычная ссылка.
import type { ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'

export const PLACEMENT_PATH = '/app/test'

export function PlacementLink({ className, children, testId }: { className?: string; children: ReactNode; testId?: string }) {
  const inRouter = useInRouterContext()
  return inRouter
    ? <Link className={className} to={PLACEMENT_PATH} data-testid={testId}>{children}</Link>
    : <a className={className} href={PLACEMENT_PATH} data-testid={testId}>{children}</a>
}
