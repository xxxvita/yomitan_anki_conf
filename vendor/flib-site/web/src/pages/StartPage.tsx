import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseVideoId } from '../lib/parse-video-id'

export function StartPage() {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState(false)
  const navigate = useNavigate()
  const go = (e: React.FormEvent) => {
    e.preventDefault()
    const id = parseVideoId(url)
    if (!id) { setErr(true); return }
    navigate(`/player?v=${id}`)
  }
  return (
    <div className="start-page" data-dusk="site">
      <header className="hero">
        <h1>Turmalinki TV</h1>
        <p className="tagline">Учите английский по фильмам — двуязычные субтитры поверх YouTube.</p>
        <form className="url-form" onSubmit={go}>
          <input
            data-testid="yt-url"
            placeholder="Вставьте ссылку на YouTube…"
            value={url}
            onChange={e => { setUrl(e.target.value); setErr(false) }}
          />
          <button type="submit">Смотреть</button>
        </form>
        {err && <div className="url-error" data-testid="url-error">Не распознал YouTube-ссылку.</div>}
      </header>
      <section className="how">
        <h2>Как это работает</h2>
        <ol>
          <li>Вставьте ссылку на YouTube-ролик.</li>
          <li>Смотрите с субтитрами на английском и русском одновременно.</li>
          <li>Наводите курсор на слова — их разберёт Ваш Yomitan.</li>
        </ol>
      </section>
    </div>
  )
}
