// GoalPoster — постер из нашего каталога (`/api/puzzle/preview`), общий для
// курируемых карточек и карточек каталога тайтлов. Пока грузится — цветная заглушка
// с названием (как в макете); ошибка загрузки или нет слага — плашка surface-2 с
// названием по центру, битой картинки не бывает никогда.
import { useState } from 'react'
import { puzzlePreviewURL } from '../../api'
import { CabI } from '../cab-icons'

export function GoalPoster({ slug, title, hue, on }: { slug?: string; title: string; hue: number; on: boolean }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const none = !slug || failed
  return (
    <span className={'pst' + (none ? ' none' : '')} style={{ ['--h' as string]: String(hue) }}>
      {!none && <img src={puzzlePreviewURL(slug!)} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
      {(none || !loaded) && <span className="pst-t">{title}</span>}
      {on && <span className="gc-ck"><CabI.check /></span>}
    </span>
  )
}
