// LoginModal.tsx — «Войти» (Э6, Shadowing-гейт): пользователь вводит СВОЙ
// tpk-ключ, бэк проверяет капу elevenlabs_realtime через gateway
// (POST /api/access, см. internal/bff/access.go). Сайт без ключа работает
// полностью (маршруты/тест/плеер) — гейтится только Shadowing-режим в
// плеере (web/src/player/shadow-access.ts).
//
// Паттерн модалки — RouteSettingsModal (RoutePage.tsx): те же CSS-классы
// rs-overlay/rs-modal/rs-head/rs-x/rs-body/rs-foot (site-theme.css), Esc и
// клик по фону закрывают, клик по самой карточке — нет.
//
// feedback-1 п.4 (баг «Войти»): раньше LoginModal рендерился инлайн внутри
// .site-header, а у .site-header есть `backdrop-filter: blur(16px)`
// (site-theme.css) — по спеке CSS filter/backdrop-filter на предке создаёт
// новый containing block для потомков с position:fixed. rs-overlay
// (position:fixed;inset:0) поэтому позиционировался не относительно
// вьюпорта, а относительно .site-header — на проде это выглядело как
// "модалка уезжает/обрезается при скролле" (владелец воспроизвёл вживую,
// транскрипт 2026-07-14, 00:41–01:02). Фикс — createPortal(..., document.body):
// вне .site-header нет предка с backdrop-filter/transform/filter, значит нет
// чужого containing block, fixed позиционируется от вьюпорта как положено.
//
// Ловушка портала: document.body не имеет предка с классом .site, а ВСЕ
// цвета/шрифты темы — CSS-переменные, объявленные на `.site` (site-theme.css)
// и потребляемые как `var(--amber)` и т.п. Без .site-предка переменные
// резолвятся в initial/unset — модалка отрендерится, но будет выглядеть
// сломанной (прозрачный текст, не тот фон). Дешёвое решение (не заводить
// отдельный портал-рут в index.html/main.tsx ради одной модалки) — обернуть
// сам оверлей в `<div className="site">`, ре-объявляя токены локально. Чтобы
// этот div не добавлял на body лишний пустой блок высотой `.site`-класса
// (`min-height: 100vh` — а внутри него ничего в нормальном потоке, всё
// содержимое — position:fixed rs-overlay), схлопываем высоту инлайн-стилем.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { checkAccess } from './access'
import { dropSessionCookie } from './session'
import { TELEGRAM_CHANNEL_URL, TELEGRAM_BOT_URL } from './external-links'

type Status = 'idle' | 'checking' | 'invalid' | 'valid-no-cap' | 'valid-cap' | 'network-error'

export function LoginModal({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const resolved = status === 'valid-no-cap' || status === 'valid-cap'
  const checking = status === 'checking'

  async function handleCheck() {
    const trimmed = key.trim()
    if (!trimmed || checking) return
    setStatus('checking')
    const result = await checkAccess(trimmed)
    if (!result.ok) {
      setStatus('network-error')
      return
    }
    if (!result.valid) {
      setStatus('invalid')
      return
    }
    // Кабинет выключен, но cookie сессии могла остаться от включённого
    // (откат флага): стираем её, иначе cookie истёкшего или заменённого ключа
    // перебивала бы только что введённый ключ в модулях и Shadowing (спека
    // кабинета §3.6, N-I3). Старые ключи браузера НЕ трогаем — их только что
    // записал checkAccess. Без SESSION_KEYS ответ 404 — безвредно. Снимок
    // перечитывается, другие вкладки узнают по каналу.
    void dropSessionCookie()
    setStatus(result.shadowing ? 'valid-cap' : 'valid-no-cap')
  }

  return createPortal(
    // .site здесь ТОЛЬКО ради CSS-переменных темы (см. комментарий сверху
    // файла) — minHeight:0 не даёт этому div добавить пустой блок высотой
    // 100vh в конец <body> (класс .site задаёт min-height:100vh для
    // полноэкранных страниц, здесь это не нужно — весь видимый контент уже
    // position:fixed внутри .rs-overlay).
    <div className="site" style={{ minHeight: 0 }}>
      <div className="rs-overlay" onClick={onClose}>
        <div className="rs-modal login-modal" onClick={e => e.stopPropagation()}>
          <div className="rs-head">
            <div>
              <div className="eyebrow">Личный кабинет</div>
              <h2>Войти по ключу</h2>
              <p>Ключ включает Shadowing (тренировку произношения) — остальной сайт открыт и без него.</p>
              {/* Путь к покупке (жалоба владельца 2026-11-17). Ссылка
               *  ОТНОСИТЕЛЬНАЯ: сайт живёт на flib.club и flibooster.ru,
               *  покупатель остаётся на своём домене. Обычный <a>, не <Link>:
               *  окно рендерится и вне роутера (тесты), /buy отдаёт та же SPA. */}
              <a className="login-buy-link" href="/buy">Нет ключа? Купить</a>
            </div>
            <button type="button" className="rs-x" onClick={onClose} aria-label="закрыть">✕</button>
          </div>
          <div className="rs-body">
            <div className="rs-field">
              <label className="rf-lbl" htmlFor="login-key-input">Ключ</label>
              <input
                id="login-key-input"
                className="login-key-input"
                type="password"
                placeholder="tpk_…"
                autoComplete="off"
                spellCheck={false}
                // Ревью M5: ссылка «Купить» в шапке стоит раньше поля, и без
                // фокуса первый Tab уводил мимо него. Фокус сразу в поле.
                autoFocus
                value={key}
                disabled={checking}
                onChange={e => { setKey(e.target.value); setStatus('idle') }}
                onKeyDown={e => { if (e.key === 'Enter' && !resolved) handleCheck() }}
              />
              {status === 'checking' && (
                <div className="login-status">Проверяем…</div>
              )}
              {status === 'invalid' && (
                <div className="login-status login-status-bad">Ключ не принят сервером</div>
              )}
              {status === 'network-error' && (
                <div className="login-status login-status-bad">Не удалось проверить ключ — попробуйте ещё раз</div>
              )}
              {status === 'valid-no-cap' && (
                <div className="login-status login-status-warn">Ключ принят, но Shadowing недоступен этому ключу</div>
              )}
              {status === 'valid-cap' && (
                <div className="login-status login-status-ok">✓ Shadowing доступен</div>
              )}
            </div>
            {/* Демо-ключ [ID:P-demo-key] (голосовое ТЗ владельца 2026-07-16):
             *  ключа у нового пользователя нет — подсказываем, что бесплатный
             *  демо-ключ выдаёт Telegram-бот проекта, и зовём в канал. Ссылки —
             *  из external-links.ts (общий источник с подвалом LandingPage). */}
            <div className="login-demo">
              <p className="login-demo-text">
                <b>Демо-ключ можно получить бесплатно</b> у нашего Telegram-бота.
                Загляните и в наш канал — там новости и помощь.
              </p>
              <div className="login-demo-links">
                <a
                  className="login-demo-link login-demo-link-primary"
                  href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer"
                >Получить демо-ключ у бота →</a>
                <a
                  className="login-demo-link"
                  href={TELEGRAM_CHANNEL_URL} target="_blank" rel="noopener noreferrer"
                >Вступить в Telegram-канал</a>
              </div>
            </div>
          </div>
          <div className="rs-foot">
            {resolved ? (
              <button type="button" className="btn btn-amber" onClick={onClose}>Готово</button>
            ) : (
              <button
                type="button"
                className="btn btn-amber"
                disabled={!key.trim() || checking}
                onClick={handleCheck}
              >
                {checking ? 'Проверяем…' : 'Проверить'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
