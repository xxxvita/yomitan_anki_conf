// ForkPage.tsx — /fork, развилка воронки: три пути уточнить точку А.
//
// Порт temp/flib/fork.jsx:3-80 (ForkChooser), только вариант `cards`
// (`tweaks.forkVariant === 'cards'`) — владелец зафиксировал его в ТЗ Э1,
// вариант `fork-steps` (отдельный список-макет "по возрастанию точности")
// не переносится. Индикатор точности (1/3 · 2/3 · 3/3) в исходном варианте
// `cards` не рисовался (он был только в `fork-steps`) — ТЗ Э1 требует его и
// на карточках, поэтому сюда добавлены `.acc-bars`/`.fs-prec` из fork-step.
//
// A11y-фикс относительно прототипа: там карточка была `<div onClick>`
// (недоступна с клавиатуры). Здесь вся карточка — нативный <button>, так
// Enter/Space работают "из коробки", без ручного onKeyDown. Декоративная
// подпись "Выбрать" внутри — <span>, не вложенный <button>: вложенные
// интерактивные элементы невалидны и ломают семантику для скринридеров.
import { Link, useNavigate } from 'react-router-dom'
import { BrandMark } from './BrandMark'

interface ForkOption {
  id: string
  route: string
  ico: string
  time: string
  precision: 1 | 2 | 3
  title: string
  primary: boolean
  desc: string
  list: string[]
}

const FORKS: ForkOption[] = [
  {
    id: 'try', route: '/try', ico: '⚡', time: '~60 секунд', precision: 1,
    title: 'Попробовать', primary: true,
    desc: 'Укажите уровень, возраст и цель — покажем маршрут сразу. Словарь возьмём под Ваш CEFR.',
    list: ['CEFR', 'возраст', 'цель'],
  },
  {
    id: 'test', route: '/test', ico: '🎧', time: '5–7 минут', precision: 2,
    title: 'Быстрый тест', primary: false,
    desc: 'Послушайте слова и фразы, ответьте на слух. Оценим словарь точнее — маршрут будет ровнее.',
    list: ['словарь на слух', 'диктант', 'проверка на живой речи'],
  },
  {
    id: 'import', route: '/import', ico: '📥', time: '1 минута', precision: 3,
    title: 'Загрузить словарь', primary: false,
    desc: 'Есть словарь или список слов? Отдайте файл — точка А будет максимально точной.',
    list: ['known-words.json', '.txt / .csv', 'экспорт из любого сервиса'],
  },
]

export function ForkPage() {
  const navigate = useNavigate()

  return (
    <div className="site">
      <div className="view">
        <div className="page">
          <div className="page-topbar">
            <BrandMark />
            <Link className="back-link" to="/">← на главную</Link>
          </div>

          <div className="fork-head">
            <div className="eyebrow">Точка А · что Вы понимаете сейчас</div>
            <h1>Как быстро уточним Ваш уровень?</h1>
            <p>Чем точнее старт — тем ровнее маршрут. Но начать можно с самого простого — уточнить всегда успеете.</p>
          </div>

          <div className="fork-cards">
            {FORKS.map(f => (
              <button
                key={f.id}
                type="button"
                className={`fork-card ${f.primary ? 'primary' : ''}`}
                onClick={() => navigate(f.route)}
              >
                {f.primary && <span className="fc-badge">быстрее всего</span>}
                <div className="fc-ico">{f.ico}</div>
                <div className="fc-time" style={{ marginTop: 14 }}>{f.time}</div>
                <div className="fs-acc" style={{ marginTop: 10 }}>
                  <span className="fs-prec">точность {f.precision}/3</span>
                  <div className="acc-bars">
                    {[1, 2, 3].map(n => <i key={n} className={n <= f.precision ? 'on' : ''} />)}
                  </div>
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
                <ul className="fc-list">
                  {f.list.map((x, i) => <li key={i}>→ <b>{x}</b></li>)}
                </ul>
                <span className={`btn ${f.primary ? 'btn-amber' : 'btn-ghost'}`} aria-hidden="true">Выбрать</span>
              </button>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 30 }} className="mono faint">
            Любой путь ведёт к маршруту. Уровень можно уточнить позже.
          </div>
        </div>
      </div>
    </div>
  )
}
