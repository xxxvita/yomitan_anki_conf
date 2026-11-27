// PlacementHomeCard.tsx — карточка «Давайте установим Ваш реальный уровень» на Главной (спека §4 «Входы»).
// Первый блок под приветствием. Нет результата, нет незаконченного прогона на сервере и не нажато «Позже»
// (по ключу владельца, переживает перезагрузку). Любой сбой сводки — карточки нет и ошибки нет.
import { useState } from 'react'
import { PlacementLink } from './PlacementLink'
import { usePlacement } from './placement/use-placement'
import { laterGet, laterSet } from './placement-entry'

export function PlacementHomeCard() {
  const pl = usePlacement(true)
  const [laterFor, setLaterFor] = useState<string | null>(null)
  const sum = pl.summary
  if (!sum || sum.last !== null || sum.pending) return null
  if (laterFor === sum.owner || laterGet(sum.owner)) return null
  return (
    <section className="panel pt-card" data-testid="home-placement"><div className="panel-in">
      <h2 className="serif">Давайте установим <em>Ваш реальный уровень</em></h2>
      <p>Около 5 минут: Вы слушаете слова и отвечаете, знаете ли их. Маршрут не будет тратить время на то, что Вы уже знаете.</p>
      <div className="row">
        <PlacementLink className="btn primary">{pl.unfinished ? 'Продолжить тест' : 'Пройти тест'}</PlacementLink>
        <button type="button" className="btn" onClick={() => { laterSet(sum.owner); setLaterFor(sum.owner) }}>Позже</button>
      </div>
    </div></section>
  )
}
